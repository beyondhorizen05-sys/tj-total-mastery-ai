import type { ModelRouter } from '../models/router.js';
import type { Critique, Intent, Plan } from './types.js';
import { extractJson, sanitizePlan } from './types.js';
import { INTENT_SYSTEM, PLANNER_SYSTEM, CRITIC_SYSTEM, GOAL_HINT } from './prompts.js';

export interface PlanResult { plan: Plan; source: 'model' | 'fallback'; model_id: string | null; cost_usd: number | null }

/**
 * Cognitive engine (Spec §6): intent → plan → critique/verify. Structured, user-visible outputs only;
 * no private chain-of-thought is requested or stored.
 */
export class CognitiveEngine {
  constructor(private router: ModelRouter) {}

  heuristicIntent(text: string): Intent {
    const goal = GOAL_HINT.test(text) && text.length > 40;
    return { intent: goal ? 'goal' : 'chat', complexity: goal ? (text.length > 160 ? 'high' : 'medium') : 'low', domains: ['general'], needs_tools: goal, summary: text.slice(0, 80), source: 'heuristic' };
  }

  async classify(text: string, ctx: { project_id?: string | null } = {}): Promise<Intent> {
    try {
      const r = await this.router.chat({ task_type: 'classification', complexity: 'low', needs_json: true }, { messages: [{ role: 'system', content: INTENT_SYSTEM }, { role: 'user', content: text }], json: true, temperature: 0, max_tokens: 200 }, ctx);
      const j = extractJson<any>(r.text);
      if (j && (j.intent === 'chat' || j.intent === 'goal')) {
        return { intent: j.intent, complexity: ['low', 'medium', 'high'].includes(j.complexity) ? j.complexity : 'medium', domains: Array.isArray(j.domains) ? j.domains.map(String) : [], needs_tools: !!j.needs_tools, summary: String(j.summary ?? text.slice(0, 80)), source: 'model' };
      }
    } catch { /* fall through to heuristic */ }
    return this.heuristicIntent(text);
  }

  async plan(goal: string, extra: { memory?: string; project_id?: string | null; model_id?: string | null; feedback?: string } = {}): Promise<PlanResult> {
    const user = [`Goal:\n${goal}`, extra.memory ? `Relevant memory:\n${extra.memory}` : '', extra.feedback ? `Previous plan was rejected. Feedback:\n${extra.feedback}` : ''].filter(Boolean).join('\n\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await this.router.chat({ task_type: 'planning', complexity: 'high', needs_json: true, model_id: extra.model_id }, { messages: [{ role: 'system', content: PLANNER_SYSTEM }, { role: 'user', content: user }], json: true, temperature: 0.3, max_tokens: 2500 }, { project_id: extra.project_id });
        const plan = sanitizePlan(extractJson(r.text), goal);
        if (plan) return { plan, source: 'model', model_id: r.model_id, cost_usd: r.cost_usd };
      } catch (e) {
        if (attempt === 1) throw e;
      }
    }
    return { plan: this.fallbackPlan(goal), source: 'fallback', model_id: null, cost_usd: null };
  }

  /** Generic plan used only when a model repeatedly fails to produce valid JSON. Labelled as fallback. */
  fallbackPlan(goal: string): Plan {
    return {
      objective: goal, success_criteria: ['Deliverable files exist in the project directory', 'Tests or a run command execute successfully'], assumptions: ['Planner model returned no valid plan; using generic fallback plan'],
      constraints: ['Work inside the project sandbox'], risks: ['Generic plan may not fit the goal precisely'], rollback: 'Delete the project directory',
      tasks: [
        { id: 't1', title: 'Research and decide approach', role: 'Researcher', description: `Research approaches for: ${goal}. Record sources and conclusions in notes.md.`, depends_on: [], tools: ['web_search', 'web_fetch', 'fs_write', 'memory_save'] },
        { id: 't2', title: 'Implement', role: 'Developer', description: 'Implement the chosen approach in the project directory.', depends_on: ['t1'], tools: ['fs_read', 'fs_write', 'fs_list', 'shell_exec'] },
        { id: 't3', title: 'Test', role: 'QA Engineer', description: 'Run the implementation/tests and report exact results; fix trivial failures.', depends_on: ['t2'], tools: ['fs_read', 'fs_write', 'shell_exec'] },
      ],
    };
  }

  /** Independent critic/verifier pass. Prefers a different model than the executor when available. */
  async critique(goal: string, plan: Plan, evidence: string, opts: { exclude_model?: string | null; project_id?: string | null } = {}): Promise<Critique & { model_id: string | null }> {
    const content = `Goal: ${goal}\nSuccess criteria:\n- ${plan.success_criteria.join('\n- ') || '(none stated)'}\n\nEvidence of work:\n${evidence.slice(0, 12000)}`;
    const attempt = (exclude?: string[]) => this.router.chat({ task_type: 'verification', complexity: 'medium', needs_json: true, exclude }, { messages: [{ role: 'system', content: CRITIC_SYSTEM }, { role: 'user', content }], json: true, temperature: 0, max_tokens: 800 }, { project_id: opts.project_id });
    try {
      let r;
      try { r = await attempt(opts.exclude_model ? [opts.exclude_model] : undefined); } catch { r = await attempt(); }
      const j = extractJson<any>(r.text);
      if (j && ['pass', 'revise', 'fail'].includes(j.verdict)) {
        return { verdict: j.verdict, confidence: Math.max(0, Math.min(1, Number(j.confidence ?? 0.5))), issues: Array.isArray(j.issues) ? j.issues.map(String) : [], suggestions: Array.isArray(j.suggestions) ? j.suggestions.map(String) : [], model_id: r.model_id };
      }
    } catch { /* fall through */ }
    return { verdict: 'revise', confidence: 0, issues: ['Critic could not produce a valid verdict; result is UNVERIFIED by a model'], suggestions: [], model_id: null };
  }
}
