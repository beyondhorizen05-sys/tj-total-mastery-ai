import { z } from 'zod';

export const ISO = z.string();
export const JSONRecord = z.record(z.string(), z.unknown());

export const User = z.object({
  id: z.string(),
  display_name: z.string(),
  locale: z.string().default('en-US'),
  time_zone: z.string().default('UTC'),
  created_at: ISO,
});
export type User = z.infer<typeof User>;

export const Workspace = z.object({
  id: z.string(),
  name: z.string(),
  owner_id: z.string(),
  data_dir: z.string(),
  created_at: ISO,
});
export type Workspace = z.infer<typeof Workspace>;

export const Project = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  root_path: z.string(),
  status: z.enum(['active', 'archived', 'completed']).default('active'),
  created_at: ISO,
  updated_at: ISO,
});
export type Project = z.infer<typeof Project>;

export const Conversation = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  title: z.string(),
  created_at: ISO,
  updated_at: ISO,
});
export type Conversation = z.infer<typeof Conversation>;

export const MessageRole = z.enum(['user', 'assistant', 'system', 'tool']);

/** User-facing transparency — NOT private chain-of-thought (Spec §4 Layer 3). */
export const MessageTrace = z.object({
  reasoning_summary: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  sources: z.array(z.object({ title: z.string(), url: z.string().optional(), retrieved_at: z.string().optional() })).optional(),
  tool_calls: z.array(z.object({ tool: z.string(), status: z.string(), duration_ms: z.number().optional(), summary: z.string().optional() })).optional(),
  tokens_in: z.number().optional(),
  tokens_out: z.number().optional(),
  cost_usd: z.number().nullable().optional(),
  latency_ms: z.number().optional(),
  fallback_from: z.string().optional(),
  plan_id: z.string().optional(),
  workflow_run_id: z.string().optional(),
});
export type MessageTrace = z.infer<typeof MessageTrace>;

export const Message = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: MessageRole,
  content: z.string(),
  model_id: z.string().nullable(),
  provider_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  trace: MessageTrace.nullable().default(null),
  attachments: z.array(z.object({ type: z.string(), path: z.string().optional(), name: z.string(), mime: z.string().optional() })).default([]),
  created_at: ISO,
});
export type Message = z.infer<typeof Message>;

export const Settings = z.object({
  first_run_completed: z.boolean().default(false),
  profile_name: z.string().default(''),
  locale: z.string().default('en-US'),
  time_zone: z.string().default('UTC'),
  autonomy_level: z.number().int().min(0).max(5).default(2),
  privacy_mode: z.enum(['local-only', 'balanced', 'cloud-ok']).default('balanced'),
  default_model_id: z.string().nullable().default(null),
  routing_mode: z.enum(['auto', 'manual']).default('auto'),
  router_priority: z.enum(['balanced', 'cheapest', 'fastest', 'quality', 'local-only', 'private-only']).default('balanced'),
  budget_daily_usd: z.number().nullable().default(null),
  budget_monthly_usd: z.number().nullable().default(null),
  max_request_cost_usd: z.number().nullable().default(null),
  notifications_enabled: z.boolean().default(true),
  reduced_motion: z.boolean().default(false),
  high_contrast: z.boolean().default(false),
  font_scale: z.number().default(1),
  sidebar_modules: z.array(z.string()).default([]),
  town_view_enabled: z.boolean().default(true),
  memory_auto_capture: z.boolean().default(false),
  voice_language: z.string().default('en-US'),
  voice_name: z.string().nullable().default(null),
  microphone_granted: z.boolean().default(false),
  camera_granted: z.boolean().default(false),
  screen_granted: z.boolean().default(false),
});
export type Settings = z.infer<typeof Settings>;
