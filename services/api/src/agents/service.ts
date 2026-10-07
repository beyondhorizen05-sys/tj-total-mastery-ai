import type { Agent, AgentStatus } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/event-bus.js';
import { uuid, now } from '../core/ids.js';
import { J, mapRow } from '../db/repo.js';
import { AGENT_TEMPLATES, templateById, templateForRole } from './templates.js';

const JSON_COLS = ['capabilities', 'tools', 'connectors', 'permissions', 'objectives', 'metrics'];

export interface CreateAgentInput {
  workspace_id: string;
  template_id?: string;
  name?: string;
  role?: string;
  description?: string;
  personality?: string;
  system_instructions?: string;
  project_id?: string | null;
  model_id?: string | null;
  tools?: string[];
  permissions?: string[];
  budget_usd?: number | null;
  avatar?: string;
  town_area?: string;
  objectives?: string[];
}

/** Agent registry + lifecycle (Spec §7-8). Status always mirrors real backend state. */
export class AgentService {
  constructor(private db: Database, private bus: EventBus) {}

  templates() { return AGENT_TEMPLATES; }

  create(input: CreateAgentInput): Agent {
    const tpl = (input.template_id ? templateById(input.template_id) : undefined) ?? (input.role ? templateForRole(input.role) : undefined);
    const ts = now();
    const a: Agent = {
      id: uuid(), workspace_id: input.workspace_id, project_id: input.project_id ?? null, template_id: tpl?.id ?? null,
      name: input.name ?? tpl?.name ?? 'Agent', role: input.role ?? tpl?.role ?? 'Specialist',
      description: input.description ?? tpl?.description ?? '', avatar: input.avatar ?? tpl?.avatar ?? '🤖',
      personality: input.personality ?? tpl?.personality ?? '',
      system_instructions: input.system_instructions || tpl?.system_instructions || `You are ${input.name ?? 'a specialist agent'}, an expert in ${input.role ?? 'your field'}. Never claim an action succeeded without tool confirmation.`,
      provider_id: input.model_id ? input.model_id.split('/')[0] : null, model_id: input.model_id ?? null,
      capabilities: tpl?.capabilities ?? [(input.role ?? 'specialist').toLowerCase()],
      tools: input.tools ?? tpl?.tools ?? [], connectors: [],
      permissions: (input.permissions as any) ?? tpl?.permissions ?? ['memory.read'],
      memory_scope: 'project', objectives: input.objectives ?? [], current_task_id: null, status: 'idle', confidence: null,
      budget_usd: input.budget_usd ?? null, spent_usd: 0, metrics: { tasks_completed: 0, tasks_failed: 0, tool_calls: 0, tokens: 0 },
      town_area: input.town_area ?? tpl?.town_area ?? 'command_center', created_at: ts, updated_at: ts,
    };
    this.db.run(
      `INSERT INTO agents (id, workspace_id, project_id, template_id, name, role, description, avatar, personality, system_instructions, provider_id, model_id, capabilities, tools, connectors, permissions, memory_scope, objectives, current_task_id, status, confidence, budget_usd, spent_usd, metrics, town_area, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [a.id, a.workspace_id, a.project_id, a.template_id, a.name, a.role, a.description, a.avatar, a.personality, a.system_instructions, a.provider_id, a.model_id, J.str(a.capabilities), J.str(a.tools), J.str(a.connectors), J.str(a.permissions), a.memory_scope, J.str(a.objectives), null, a.status, null, a.budget_usd, 0, J.str(a.metrics), a.town_area, ts, ts],
    );
    this.bus.emit({ name: 'agent.created', summary: `Agent created: ${a.name} (${a.role})`, agent_id: a.id, project_id: a.project_id, data: { template: a.template_id, town_area: a.town_area } });
    return a;
  }

  get(id: string): Agent | undefined {
    const r = this.db.get<any>('SELECT * FROM agents WHERE id = ?', [id]);
    return r ? mapRow<Agent>(r, JSON_COLS) : undefined;
  }

  list(f: { project_id?: string | null; status?: string } = {}): Agent[] {
    const where: string[] = []; const p: unknown[] = [];
    if (f.project_id) { where.push('project_id = ?'); p.push(f.project_id); }
    if (f.status) { where.push('status = ?'); p.push(f.status); }
    return this.db.all<any>(`SELECT * FROM agents ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`, p).map((r) => mapRow<Agent>(r, JSON_COLS));
  }

  update(id: string, patch: Partial<Pick<Agent, 'name' | 'description' | 'personality' | 'system_instructions' | 'model_id' | 'tools' | 'permissions' | 'budget_usd' | 'avatar' | 'objectives' | 'memory_scope'>>): Agent {
    const a = this.get(id);
    if (!a) throw new Error('Agent not found');
    const allowed = ['name', 'description', 'personality', 'system_instructions', 'model_id', 'tools', 'permissions', 'budget_usd', 'avatar', 'objectives', 'memory_scope'];
    const sets: string[] = []; const p: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || !allowed.includes(k)) continue;
      sets.push(`${k} = ?`);
      p.push(Array.isArray(v) ? J.str(v) : v);
      if (k === 'model_id') { sets.push('provider_id = ?'); p.push(typeof v === 'string' ? v.split('/')[0] : null); }
    }
    if (sets.length) this.db.run(`UPDATE agents SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...p, now(), id]);
    this.bus.emit({ name: 'agent.updated', summary: `Agent updated: ${a.name}`, agent_id: id });
    return this.get(id)!;
  }

  delete(id: string) { this.db.run('DELETE FROM agents WHERE id = ?', [id]); }

  setStatus(id: string, status: AgentStatus, taskId?: string | null) {
    this.db.run('UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?', [status, taskId ?? null, now(), id]);
  }

  /** Reset any agents left mid-flight (crash recovery / STOP ALL). */
  resetActive(to: AgentStatus = 'idle') {
    this.db.run("UPDATE agents SET status = ?, current_task_id = NULL, updated_at = ? WHERE status IN ('thinking','working','waiting_approval','meeting')", [to, now()]);
  }

  addMetrics(id: string, d: { tasks_completed?: number; tasks_failed?: number; tool_calls?: number; tokens?: number; cost?: number; confidence?: number }) {
    const a = this.get(id);
    if (!a) return;
    const m = { tasks_completed: a.metrics.tasks_completed + (d.tasks_completed ?? 0), tasks_failed: a.metrics.tasks_failed + (d.tasks_failed ?? 0), tool_calls: a.metrics.tool_calls + (d.tool_calls ?? 0), tokens: a.metrics.tokens + (d.tokens ?? 0) };
    this.db.run('UPDATE agents SET metrics = ?, spent_usd = spent_usd + ?, confidence = COALESCE(?, confidence), updated_at = ? WHERE id = ?', [J.str(m), d.cost ?? 0, d.confidence ?? null, now(), id]);
  }

  /** Structured agent-to-agent messages (Spec §8). */
  message(m: { from?: string | null; to?: string | null; kind: string; task_id?: string | null; project_id?: string | null; content: string; data?: Record<string, unknown> }) {
    const id = uuid();
    this.db.run('INSERT INTO agent_messages (id, ts, from_agent_id, to_agent_id, kind, task_id, project_id, content, data) VALUES (?,?,?,?,?,?,?,?,?)', [id, now(), m.from ?? null, m.to ?? null, m.kind, m.task_id ?? null, m.project_id ?? null, m.content, J.str(m.data ?? {})]);
    this.bus.emit({ name: 'agent.message', summary: `${m.kind}: ${m.content.slice(0, 100)}`, agent_id: m.from ?? null, task_id: m.task_id ?? null, project_id: m.project_id ?? null, data: { to: m.to ?? null, kind: m.kind, message_id: id } });
    return id;
  }

  messages(f: { project_id?: string; task_id?: string; limit?: number } = {}) {
    const where: string[] = []; const p: unknown[] = [];
    if (f.project_id) { where.push('project_id = ?'); p.push(f.project_id); }
    if (f.task_id) { where.push('task_id = ?'); p.push(f.task_id); }
    p.push(Math.min(f.limit ?? 100, 500));
    return this.db.all<any>(`SELECT * FROM agent_messages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`, p).map((r) => ({ ...r, data: J.parse(r.data, {}) }));
  }
}
