import type { Agent, Task } from '@tj/schemas';
import type { CognitiveEngine } from '../cognitive/engine.js';
import type { Plan, PlanTask } from '../cognitive/types.js';
import type { AgentService } from '../agents/service.js';
import type { AgentRuntime } from '../agents/runtime.js';
import type { TaskService } from '../tasks/service.js';
import type { WorkspaceService } from '../core/workspace.js';
import type { MemoryService } from '../memory/memory.js';
import type { EventBus } from '../core/event-bus.js';
import type { Database } from '../db/database.js';
import { templateForRole } from '../agents/templates.js';
import { uuid, now } from '../core/ids.js';
import { J } from '../db/repo.js';
import { scheduleRows, summarizeRun } from './scheduler.js';
import type { PlanRow, TaskResultRow } from './scheduler.js';
import { assessGoalEvidence, snapshotProjectFiles, type GoalEvidence, type SuccessfulTool } from './evidence.js';

export interface GoalRunResult {
  plan_id: string;
  project_id: string;
  status: 'completed' | 'failed' | 'cancelled' | 'partial';
  summary: string;
  task_results: TaskResultRow[];
  verdict: { verdict: string; confidence: number; issues: string[]; verified_by: string | null } | null;
  artifacts: Array<{ name: string; path?: string }>;
  cost_usd: number;
  plan_source: string;
  evidence: GoalEvidence;
}

/**
 * Multi-agent orchestrator (Spec §7-8, §84).
 * Goal → plan → project → team (dynamic agent creation) → dependency-ordered parallel execution
 * → critic verification → bounded repair loop → memory. Every step is persisted and emits events.
 */
export class Orchestrator {
  private controllers = new Map<string, AbortController>();

  constructor(
    private cognitive: CognitiveEngine, private agents: AgentService, private runtime: AgentRuntime, private tasks: TaskService,
    private ws: WorkspaceService, private memory: MemoryService, private bus: EventBus, private db: Database,
  ) {}

  /** Abort every active goal run (STOP ALL). */
  stopAll() { for (const c of this.controllers.values()) c.abort(); }
  stop(planId: string) { this.controllers.get(planId)?.abort(); }
  activeRuns() { return this.controllers.size; }

  savePlan(goal: string, plan: Plan, projectId: string | null, conversationId: string | null, status = 'created'): string {
    const id = uuid(), ts = now();
    this.db.run('INSERT INTO plans (id, project_id, conversation_id, goal, plan, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, projectId, conversationId, goal, J.str(plan), status, ts, ts]);
    return id;
  }
  setPlanStatus(id: string, status: string) { this.db.run('UPDATE plans SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id]); }
  getPlan(id: string) {
    const r = this.db.get<any>('SELECT * FROM plans WHERE id = ?', [id]);
    return r ? { ...r, plan: J.parse<Plan>(r.plan, null as any) } : undefined;
  }
  listPlans(limit = 50) { return this.db.all<any>('SELECT id, project_id, conversation_id, goal, status, created_at, updated_at FROM plans ORDER BY created_at DESC LIMIT ?', [limit]); }

  /** Find or dynamically create the specialist for a plan role (Spec §8). */
  private agentFor(role: string, projectId: string, tools?: string[]): Agent {
    const existing = this.agents.list({ project_id: projectId }).find((a) => a.role.toLowerCase() === role.toLowerCase() || a.name.toLowerCase() === role.toLowerCase());
    if (existing) return existing;
    const tpl = templateForRole(role);
    const agent = this.agents.create({ workspace_id: this.ws.workspaceId, project_id: projectId, template_id: tpl?.id, name: tpl ? undefined : `${role} Specialist`, role: tpl ? undefined : role, tools: tpl ? undefined : (tools?.length ? tools : ['fs_read', 'fs_write', 'fs_list', 'memory_search']), permissions: tpl ? undefined : ['filesystem.read', 'filesystem.write', 'memory.read', 'network.http'] });
    this.bus.emit({ name: 'agent.created', summary: tpl ? `Assigned ${agent.name} to project` : `Created new specialist: ${agent.name} (no template matched "${role}")`, agent_id: agent.id, project_id: projectId, data: { dynamic: !tpl } });
    return agent;
  }

  /** Create project + team + tasks from a plan; does not execute. */
  prepare(goal: string, plan: Plan, opts: { project_id?: string | null; conversation_id?: string | null; project_name?: string } = {}) {
    const project = opts.project_id ? this.ws.getProject(opts.project_id)! : this.ws.createProject(opts.project_name ?? goal.slice(0, 60), goal);
    const planId = this.savePlan(goal, plan, project.id, opts.conversation_id ?? null);
    const idMap = new Map<string, string>();
    const taskRows: Array<{ pt: PlanTask; task: Task; agent: Agent }> = [];
    for (const pt of plan.tasks) {
      const agent = this.agentFor(pt.role, project.id, pt.tools);
      const task = this.tasks.create({ workspace_id: this.ws.workspaceId, project_id: project.id, agent_id: agent.id, title: pt.title, description: pt.description, risk: pt.risk ?? 'low' });
      idMap.set(pt.id, task.id);
      taskRows.push({ pt, task, agent });
      this.agents.message({ from: null, to: agent.id, kind: 'delegation', task_id: task.id, project_id: project.id, content: `Assigned: ${pt.title}` });
    }
    for (const { pt, task } of taskRows) {
      for (const dep of pt.depends_on) {
        const depId = idMap.get(dep);
        if (depId) this.tasks.addDependency(task.id, depId);
      }
    }
    return { project, plan_id: planId, tasks: taskRows };
  }

  /** Execute a prepared plan, then verify (with a bounded repair loop) and remember. */
  async execute(prepared: ReturnType<Orchestrator['prepare']>, goal: string, plan: Plan, opts: { plan_source?: string; max_repairs?: number; concurrency?: number } = {}): Promise<GoalRunResult> {
    const { project, plan_id, tasks: rows } = prepared;
    const ctrl = new AbortController();
    this.controllers.set(plan_id, ctrl);
    this.setPlanStatus(plan_id, 'running');
    const outputs = new Map<string, string>();
    const results: TaskResultRow[] = [];
    const artifacts: GoalRunResult['artifacts'] = [];
    const beforeFiles = snapshotProjectFiles(project.root_path);
    const successfulTools: SuccessfulTool[] = [];
    let cost = 0;

    const runRow = async (row: PlanRow, extra = ''): Promise<boolean> => {
      const { pt, task, agent } = row;
      const upstream = pt.depends_on.map((d) => { const dep = rows.find((r) => r.pt.id === d); return dep ? `## ${dep.pt.title} (by ${dep.agent.name})\n${outputs.get(dep.task.id) ?? ''}` : ''; }).filter(Boolean).join('\n\n');
      this.tasks.setStatus(task.id, 'running', { agent_id: agent.id });
      const r = await this.runtime.run({
        agent: this.agents.get(agent.id)!, instruction: pt.description + extra, context: upstream || undefined, workspace_id: this.ws.workspaceId,
        project_id: project.id, project_root: project.root_path, task_id: task.id, signal: ctrl.signal,
        task_type: /code|implement|build|develop/i.test(pt.title) ? 'coding' : /research/i.test(pt.title) ? 'research' : 'chat',
      });
      cost += r.cost_usd;
      for (const call of r.tool_calls) if (call.ok) successfulTools.push({ tool: call.tool, task_title: pt.title, summary: call.summary, test_command: call.test_command });
      outputs.set(task.id, r.output);
      for (const a of r.artifacts) {
        artifacts.push({ name: a.name, path: a.path });
        this.ws.addArtifact({ project_id: project.id, task_id: task.id, agent_id: agent.id, kind: 'file', name: a.name, path: a.path ?? null, summary: a.summary });
      }
      this.agents.message({ from: agent.id, to: null, kind: r.ok ? 'result' : 'alert', task_id: task.id, project_id: project.id, content: r.output.slice(0, 500) });
      if (r.ok) this.tasks.setStatus(task.id, 'completed', { result: { output: r.output.slice(0, 4000), tool_calls: r.tool_calls.length }, error: null });
      else this.tasks.setStatus(task.id, ctrl.signal.aborted ? 'cancelled' : 'failed', { error: r.error ?? 'failed', result: { output: r.output.slice(0, 2000) } });
      const entry: TaskResultRow = { task_id: task.id, plan_task_id: pt.id, title: pt.title, agent: agent.name, status: r.ok ? 'completed' : 'failed', output: r.output, error: r.error };
      const i = results.findIndex((x) => x.task_id === task.id);
      if (i >= 0) results[i] = entry; else results.push(entry);
      return r.ok;
    };

    await scheduleRows(rows, runRow, this.tasks, ctrl.signal, opts.concurrency ?? 3);
    for (const { pt, task, agent } of rows) {
      if (results.some((r) => r.task_id === task.id)) continue;
      const current = this.tasks.get(task.id);
      results.push({ task_id: task.id, plan_task_id: pt.id, title: pt.title, agent: agent.name, status: current?.status ?? 'failed', output: '', error: current?.error ?? 'Task did not execute' });
    }

    let verdict: GoalRunResult['verdict'] = null;
    const aborted = ctrl.signal.aborted;
    if (!aborted && results.some((r) => r.status === 'completed')) {
      for (let attempt = 0; ; attempt++) {
        const evidence = results.map((r) => `### ${r.title} [${r.status}] by ${r.agent}\n${r.output.slice(0, 1800)}${r.error ? `\nERROR: ${r.error}` : ''}`).join('\n\n');
        const c = await this.cognitive.critique(goal, plan, evidence, { project_id: project.id });
        verdict = { verdict: c.verdict, confidence: c.confidence, issues: c.issues, verified_by: c.model_id };
        this.agents.message({ from: null, to: null, kind: 'critique', project_id: project.id, content: `Verdict: ${c.verdict} (${c.confidence}) ${c.issues.join('; ')}` });
        if (c.verdict === 'pass' || attempt >= (opts.max_repairs ?? 1)) break;
        const failedRows = rows.filter((r) => results.find((x) => x.task_id === r.task.id)?.status === 'failed');
        const feedback = `\n\nA reviewer found issues. Fix them and verify:\n- ${[...c.issues, ...c.suggestions].join('\n- ')}`;
        for (const t of failedRows.length ? failedRows : rows.slice(-1)) { this.tasks.setStatus(t.task.id, 'retrying'); await runRow(t, feedback); }
      }
    }

    const evidence = assessGoalEvidence(goal, plan, project.root_path, beforeFiles, successfulTools);
    if (evidence.gaps.length && !aborted) {
      verdict = { verdict: 'revise', confidence: 0, issues: [...(verdict?.issues ?? []), ...evidence.gaps], verified_by: null };
    }
    const completed = results.filter((r) => r.status === 'completed').length;
    const allDone = rows.length > 0 && completed === rows.length;
    const status: GoalRunResult['status'] = aborted ? 'cancelled' : allDone && evidence.gaps.length === 0 && (!verdict || verdict.verdict === 'pass') ? 'completed' : completed ? 'partial' : 'failed';
    const summary = summarizeRun(goal, status, results, verdict);
    this.setPlanStatus(plan_id, status);
    this.ws.setProjectStatus(project.id, status === 'completed' ? 'completed' : 'active');
    this.controllers.delete(plan_id);
    if (!aborted) {
      await this.memory.create({
        workspace_id: this.ws.workspaceId, project_id: project.id, type: 'project', source: 'orchestrator', owner: 'tj', confidence: verdict ? verdict.confidence : 0.5, provenance: { plan_id },
        content: `Goal: ${goal}\nOutcome: ${status}. ${verdict ? `Verifier: ${verdict.verdict} (${verdict.confidence}). ` : 'Not verified by a model. '}Tasks: ${results.map((r) => `${r.title}=${r.status}`).join(', ')}`,
      }).catch(() => null);
    }
    return { plan_id, project_id: project.id, status, summary, task_results: results, verdict, artifacts, cost_usd: cost, plan_source: opts.plan_source ?? 'model', evidence };
  }
}
