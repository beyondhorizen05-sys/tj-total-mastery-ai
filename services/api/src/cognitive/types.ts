export interface PlanTask {
  id: string;
  title: string;
  role: string;
  description: string;
  depends_on: string[];
  tools?: string[];
  risk?: 'low' | 'medium' | 'high' | 'critical';
}

/** Every plan has objective, success definition, assumptions, constraints, risks, rollback (Spec §6). */
export interface Plan {
  objective: string;
  success_criteria: string[];
  assumptions: string[];
  constraints: string[];
  risks: string[];
  rollback: string;
  estimated_resources?: string;
  tasks: PlanTask[];
}

export interface Intent {
  intent: 'chat' | 'goal';
  complexity: 'low' | 'medium' | 'high';
  domains: string[];
  needs_tools: boolean;
  summary: string;
  source: 'model' | 'heuristic';
}

export interface Critique {
  verdict: 'pass' | 'revise' | 'fail';
  confidence: number;
  issues: string[];
  suggestions: string[];
}

/** Extract the first JSON object from model output (handles code fences and prose). */
export function extractJson<T = any>(text: string): T | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fence?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try { return JSON.parse(c.slice(start, end + 1)) as T; } catch { /* try next */ }
  }
  return null;
}

/** Validate a plan and break cycles / dangling dependencies so the task graph is always executable. */
export function sanitizePlan(raw: any, goal: string): Plan | null {
  if (!raw || !Array.isArray(raw.tasks) || !raw.tasks.length) return null;
  const ids = new Set<string>();
  const tasks: PlanTask[] = [];
  raw.tasks.slice(0, 12).forEach((t: any, i: number) => {
    let id = String(t.id ?? `t${i + 1}`);
    if (ids.has(id)) id = `${id}_${i}`;
    ids.add(id);
    tasks.push({ id, title: String(t.title ?? `Task ${i + 1}`).slice(0, 120), role: String(t.role ?? 'Developer'), description: String(t.description ?? t.title ?? ''), depends_on: Array.isArray(t.depends_on) ? t.depends_on.map(String) : [], tools: Array.isArray(t.tools) ? t.tools.map(String) : undefined, risk: t.risk });
  });
  for (const t of tasks) t.depends_on = [...new Set(t.depends_on.filter((d) => ids.has(d) && d !== t.id))];
  // cycle breaking via DFS
  const state = new Map<string, number>();
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visit = (id: string) => {
    state.set(id, 1);
    const t = byId.get(id)!;
    t.depends_on = t.depends_on.filter((d) => {
      if (state.get(d) === 1) return false;
      if (!state.has(d)) visit(d);
      return true;
    });
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.has(t.id)) visit(t.id);
  const arr = (v: any) => (Array.isArray(v) ? v.map(String) : []);
  return { objective: String(raw.objective ?? goal), success_criteria: arr(raw.success_criteria), assumptions: arr(raw.assumptions), constraints: arr(raw.constraints), risks: arr(raw.risks), rollback: String(raw.rollback ?? 'Remove generated project directory'), estimated_resources: raw.estimated_resources ? String(raw.estimated_resources) : undefined, tasks };
}
