import { z } from 'zod';
import { Permission } from '../permissions.js';
import { ISO, JSONRecord } from './core.js';

export const AgentStatus = z.enum(['idle', 'thinking', 'working', 'waiting_approval', 'meeting', 'blocked', 'completed', 'failed', 'stopped']);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentTemplate = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  description: z.string(),
  avatar: z.string(),
  personality: z.string(),
  system_instructions: z.string(),
  capabilities: z.array(z.string()),
  tools: z.array(z.string()),
  permissions: z.array(Permission),
  /** Agent Town area where this role normally works */
  town_area: z.string(),
  builtin: z.boolean().default(true),
});
export type AgentTemplate = z.infer<typeof AgentTemplate>;

export const AgentMetrics = z.object({ tasks_completed: z.number(), tasks_failed: z.number(), tool_calls: z.number(), tokens: z.number() });

export const Agent = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  template_id: z.string().nullable(),
  name: z.string(),
  role: z.string(),
  description: z.string(),
  avatar: z.string(),
  personality: z.string(),
  system_instructions: z.string(),
  provider_id: z.string().nullable(),
  model_id: z.string().nullable(),
  capabilities: z.array(z.string()),
  tools: z.array(z.string()),
  connectors: z.array(z.string()),
  permissions: z.array(Permission),
  memory_scope: z.enum(['private', 'team', 'project', 'global']).default('project'),
  objectives: z.array(z.string()).default([]),
  current_task_id: z.string().nullable(),
  status: AgentStatus,
  confidence: z.number().min(0).max(1).nullable(),
  budget_usd: z.number().nullable(),
  spent_usd: z.number().default(0),
  metrics: AgentMetrics.default({ tasks_completed: 0, tasks_failed: 0, tool_calls: 0, tokens: 0 }),
  town_area: z.string(),
  created_at: ISO,
  updated_at: ISO,
});
export type Agent = z.infer<typeof Agent>;

export const TaskStatus = z.enum(['queued', 'analyzing', 'waiting', 'running', 'paused', 'awaiting_approval', 'retrying', 'failed', 'cancelled', 'completed', 'blocked']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  workflow_run_id: z.string().nullable(),
  parent_task_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  status: TaskStatus,
  priority: z.number().int().min(1).max(5).default(3),
  risk: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  progress: z.number().min(0).max(1).default(0),
  result: JSONRecord.nullable(),
  error: z.string().nullable(),
  attempts: z.number().default(0),
  max_attempts: z.number().default(3),
  created_at: ISO,
  started_at: ISO.nullable(),
  completed_at: ISO.nullable(),
});
export type Task = z.infer<typeof Task>;

export const TaskDependency = z.object({ task_id: z.string(), depends_on_task_id: z.string() });
export type TaskDependency = z.infer<typeof TaskDependency>;

export const ToolDefinition = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  input_schema: JSONRecord,
  permissions: z.array(Permission),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  domain: z.string(),
  /** Destructive tools support preview/diff/backup/undo (Spec §21) */
  reversible: z.boolean().default(true),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;
