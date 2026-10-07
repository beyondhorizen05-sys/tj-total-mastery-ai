import { z } from 'zod';
import { HealthState, TJState } from './status.js';

/** Request bodies validated at the API boundary (Spec §41 schema validation). */

export const ChatRequest = z.object({
  conversation_id: z.string().optional(),
  project_id: z.string().optional(),
  content: z.string().min(1).max(200_000),
  model_id: z.string().optional(),
  /** 'chat' = plain conversation; 'auto' lets TJ decide whether to plan & delegate */
  mode: z.enum(['chat', 'auto', 'build', 'research']).default('auto'),
  attachments: z.array(z.object({ type: z.string(), name: z.string(), data_base64: z.string().optional(), path: z.string().optional(), mime: z.string().optional() })).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const AddProviderRequest = z.object({
  name: z.string().min(1),
  kind: z.enum(['openai', 'openai-compatible', 'anthropic', 'google', 'ollama', 'test']),
  base_url: z.string().url().optional().nullable(),
  api_key: z.string().optional().nullable(),
  organization: z.string().optional().nullable(),
  /** well-known preset id (openai, anthropic, groq, ...) */
  preset: z.string().optional(),
});
export type AddProviderRequest = z.infer<typeof AddProviderRequest>;

export const CreateAgentRequest = z.object({
  template_id: z.string().optional(),
  name: z.string().min(1),
  role: z.string().min(1),
  description: z.string().default(''),
  personality: z.string().default(''),
  system_instructions: z.string().default(''),
  project_id: z.string().optional().nullable(),
  model_id: z.string().optional().nullable(),
  tools: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
  budget_usd: z.number().optional().nullable(),
  avatar: z.string().optional(),
  town_area: z.string().optional(),
});
export type CreateAgentRequest = z.infer<typeof CreateAgentRequest>;

export const CreateTaskRequest = z.object({
  title: z.string().min(1),
  description: z.string().default(''),
  project_id: z.string().optional().nullable(),
  agent_id: z.string().optional().nullable(),
  priority: z.number().int().min(1).max(5).default(3),
  depends_on: z.array(z.string()).optional(),
  run: z.boolean().default(false),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const CreateAutomationRequest = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  trigger: z.object({ kind: z.enum(['schedule', 'webhook', 'event', 'file_changed', 'manual']), config: z.record(z.string(), z.unknown()) }),
  workflow_id: z.string().optional(),
  /** convenience: steps to create a workflow inline */
  steps: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type CreateAutomationRequest = z.infer<typeof CreateAutomationRequest>;

export const ApprovalDecisionRequest = z.object({
  decision: z.enum(['approve_once', 'approve_workflow', 'deny', 'edit']),
  edited_payload: z.record(z.string(), z.unknown()).optional(),
});
export type ApprovalDecisionRequest = z.infer<typeof ApprovalDecisionRequest>;

export const MemoryCreateRequest = z.object({
  type: z.enum(['working', 'conversation', 'episodic', 'semantic', 'procedural', 'preference', 'project', 'agent', 'prospective', 'spatial']),
  content: z.string().min(1),
  project_id: z.string().optional().nullable(),
  agent_id: z.string().optional().nullable(),
  source: z.string().default('user'),
  confidence: z.number().min(0).max(1).default(1),
  sensitivity: z.enum(['public', 'internal', 'private', 'secret']).default('private'),
  retention: z.enum(['session', 'short', 'long', 'permanent']).default('long'),
  related_entities: z.array(z.string()).optional(),
});
export type MemoryCreateRequest = z.infer<typeof MemoryCreateRequest>;

export const ComponentHealth = z.object({
  component: z.string(),
  state: HealthState,
  detail: z.string(),
  latency_ms: z.number().nullable(),
  checked_at: z.string(),
});
export type ComponentHealth = z.infer<typeof ComponentHealth>;

export const SystemStatus = z.object({
  tj_state: TJState,
  version: z.string(),
  uptime_s: z.number(),
  current_model_id: z.string().nullable(),
  active_agents: z.number(),
  running_tasks: z.number(),
  queued_jobs: z.number(),
  pending_approvals: z.number(),
  network: z.enum(['online', 'offline', 'unknown']),
  mode: z.enum(['local', 'cloud', 'hybrid']),
  cost_today_usd: z.number(),
  cost_month_usd: z.number(),
  security_state: z.enum(['secure', 'attention', 'alert']),
  microphone: z.enum(['off', 'on', 'denied', 'unknown']),
  unread_notifications: z.number(),
  stop_all_engaged: z.boolean(),
  components: z.array(ComponentHealth),
  resources: z.object({ cpu_percent: z.number().nullable(), ram_used_mb: z.number(), ram_total_mb: z.number(), platform: z.string() }),
});
export type SystemStatus = z.infer<typeof SystemStatus>;
