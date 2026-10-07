import { z } from 'zod';
import { Permission } from '../permissions.js';
import { ISO, JSONRecord } from './core.js';

export const WorkflowStepKind = z.enum(['agent', 'tool', 'model', 'approval', 'condition', 'parallel', 'wait', 'subworkflow', 'connector', 'notify', 'transform']);
export type WorkflowStepKind = z.infer<typeof WorkflowStepKind>;

export const RetryPolicy = z.object({
  max_attempts: z.number().default(3),
  backoff_ms: z.number().default(1000),
  max_backoff_ms: z.number().default(30000),
});

export const WorkflowStep = z.object({
  id: z.string(),
  name: z.string(),
  kind: WorkflowStepKind,
  depends_on: z.array(z.string()).default([]),
  config: JSONRecord.default({}),
  retry: RetryPolicy.default({ max_attempts: 3, backoff_ms: 1000, max_backoff_ms: 30000 }),
  timeout_ms: z.number().default(120000),
  permissions: z.array(Permission).default([]),
  risk: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  /** when true, failure of this step does not fail the run (partial results, Spec §85) */
  continue_on_error: z.boolean().default(false),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const Workflow = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  name: z.string(),
  description: z.string().default(''),
  version: z.number().default(1),
  steps: z.array(WorkflowStep),
  inputs_schema: JSONRecord.default({}),
  created_at: ISO,
  updated_at: ISO,
});
export type Workflow = z.infer<typeof Workflow>;

export const WorkflowRunStatus = z.enum(['queued', 'analyzing', 'waiting', 'running', 'paused', 'awaiting_approval', 'retrying', 'failed', 'cancelled', 'completed']);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatus>;

export const StepState = z.object({
  status: z.enum(['pending', 'running', 'retrying', 'awaiting_approval', 'completed', 'failed', 'skipped', 'cancelled']),
  attempts: z.number(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  started_at: ISO.nullable(),
  completed_at: ISO.nullable(),
  next_retry_at: ISO.nullable().optional(),
});
export type StepState = z.infer<typeof StepState>;

export const WorkflowRun = z.object({
  id: z.string(),
  workflow_id: z.string(),
  workflow_version: z.number(),
  project_id: z.string().nullable(),
  status: WorkflowRunStatus,
  inputs: JSONRecord.default({}),
  step_state: z.record(z.string(), StepState).default({}),
  checkpoint: JSONRecord.default({}),
  error: z.string().nullable(),
  triggered_by: z.string(),
  created_at: ISO,
  started_at: ISO.nullable(),
  completed_at: ISO.nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRun>;

export const Automation = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  enabled: z.boolean(),
  trigger: z.object({
    kind: z.enum(['schedule', 'webhook', 'event', 'file_changed', 'manual']),
    config: JSONRecord,
  }),
  workflow_id: z.string(),
  last_run_at: ISO.nullable(),
  next_run_at: ISO.nullable(),
  run_count: z.number().default(0),
  created_at: ISO,
  updated_at: ISO,
});
export type Automation = z.infer<typeof Automation>;
