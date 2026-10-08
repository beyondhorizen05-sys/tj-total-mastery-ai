import { z } from 'zod';
import { HealthState } from '../status.js';
import { ISO } from './core.js';

export const ProviderKind = z.enum(['openai', 'openai-compatible', 'anthropic', 'google', 'ollama', 'chatgpt-plan', 'test']);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const ModelProvider = z.object({
  id: z.string(),
  name: z.string(),
  kind: ProviderKind,
  preset: z.string().nullable(),
  base_url: z.string().nullable(),
  organization: z.string().nullable(),
  /** reference into the vault; NEVER the key itself */
  credential_ref: z.string().nullable(),
  requires_api_key: z.boolean(),
  privacy_class: z.enum(['local', 'cloud']),
  enabled: z.boolean().default(true),
  health: HealthState.default('unknown'),
  last_checked_at: ISO.nullable(),
  last_error: z.string().nullable(),
  avg_latency_ms: z.number().nullable(),
  created_at: ISO,
});
export type ModelProvider = z.infer<typeof ModelProvider>;

export const Model = z.object({
  /** "<provider_id>/<model id>" */
  id: z.string(),
  provider_id: z.string(),
  model: z.string(),
  display_name: z.string(),
  modalities: z.array(z.enum(['text', 'image', 'audio', 'video'])),
  supports_tools: z.boolean(),
  supports_streaming: z.boolean(),
  supports_vision: z.boolean(),
  context_length: z.number().nullable(),
  speed_class: z.enum(['fast', 'medium', 'slow', 'unknown']),
  quality_class: z.enum(['frontier', 'strong', 'standard', 'light', 'unknown']),
  cost_class: z.enum(['free', 'low', 'medium', 'high', 'unknown']),
  privacy_class: z.enum(['local', 'cloud']),
  /** $ per 1M tokens, null when unknown — never fabricated */
  price_in_per_m: z.number().nullable(),
  price_out_per_m: z.number().nullable(),
  available: z.boolean(),
  health: HealthState,
  avg_latency_ms: z.number().nullable(),
  success_count: z.number().default(0),
  failure_count: z.number().default(0),
  discovered_at: ISO,
});
export type Model = z.infer<typeof Model>;
