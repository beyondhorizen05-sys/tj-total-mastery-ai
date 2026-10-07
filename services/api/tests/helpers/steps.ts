import type { WorkflowStep } from '@tj/schemas';

/** Build a minimal valid workflow step for tests. */
export const step = (id: string, deps: string[] = [], extra: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id, name: id, kind: 'tool', depends_on: deps, config: {}, retry: { max_attempts: 1, backoff_ms: 10, max_backoff_ms: 50 },
  timeout_ms: 2000, permissions: [], risk: 'low', continue_on_error: false, ...extra,
});
