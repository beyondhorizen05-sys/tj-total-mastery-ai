import { z } from 'zod';

/**
 * Every capability shown anywhere in TJ must carry exactly one of these states.
 * (Spec §2 — Absolute Development Rule)
 */
export const CapabilityStatus = z.enum([
  'AVAILABLE',
  'CONNECTED',
  'NEEDS_SETUP',
  'NEEDS_API_KEY',
  'NEEDS_DEVICE',
  'EXPERIMENTAL',
  'LOCAL_ONLY',
  'CLOUD_ONLY',
  'PLANNED',
  'UNAVAILABLE',
]);
export type CapabilityStatus = z.infer<typeof CapabilityStatus>;

export const HealthState = z.enum([
  'healthy',
  'degraded',
  'offline',
  'rate-limited',
  'unauthorized',
  'misconfigured',
  'unknown',
]);
export type HealthState = z.infer<typeof HealthState>;

export const CapabilityDomain = z.enum([
  'core',
  'models',
  'cognition',
  'agents',
  'memory',
  'tools',
  'files',
  'shell',
  'browser',
  'computer',
  'workflows',
  'automation',
  'connectors',
  'voice',
  'vision',
  'development',
  'research',
  'productivity',
  'business',
  'finance',
  'creative',
  'devices',
  'health',
  'security',
  'observability',
]);
export type CapabilityDomain = z.infer<typeof CapabilityDomain>;

export const Capability = z.object({
  capability_id: z.string(),
  name: z.string(),
  domain: CapabilityDomain,
  description: z.string(),
  status: CapabilityStatus,
  provider: z.string().nullable(),
  required_permissions: z.array(z.string()),
  required_credentials: z.array(z.string()),
  health: HealthState,
  latency_ms: z.number().nullable(),
  version: z.string(),
  implementation: z.string(),
  /** Human-readable explanation of exactly what is missing when not AVAILABLE/CONNECTED. */
  missing: z.string().nullable(),
  ui: z.boolean(),
  tests: z.boolean(),
});
export type Capability = z.infer<typeof Capability>;

export const TJState = z.enum([
  'idle',
  'listening',
  'hearing',
  'understanding',
  'thinking',
  'planning',
  'speaking',
  'executing',
  'awaiting_approval',
  'warning',
  'error',
  'stopped',
]);
export type TJState = z.infer<typeof TJState>;
