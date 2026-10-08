import { z } from 'zod';

/** Every tool/connector action maps to one of these permission identifiers (Spec §42). */
export const PERMISSIONS = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.delete',
  'shell.execute',
  'shell.admin',
  'browser.control',
  'computer.control',
  'network.http',
  'screen.capture',
  'camera.use',
  'microphone.use',
  'email.read',
  'email.send',
  'calendar.read',
  'calendar.write',
  'finance.read',
  'finance.trade',
  'payments.execute',
  'smart_home.control',
  'robotics.control',
  'code.execute',
  'process.manage',
  'system.info',
  'memory.read',
  'memory.write',
  'memory.delete',
  'connector.use',
  'external.publish',
  'agent.create',
  'secrets.read',
] as const;

export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

/**
 * Risk classification drives approval gating.
 *  low     — read-only / reversible, allowed at autonomy >= 3
 *  medium  — writes within sandboxed project dir, allowed at autonomy >= 3 if policy allows
 *  high    — destructive, external, financial, physical: always JIT approval (autonomy 5 semantics)
 */
export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const PERMISSION_RISK: Record<Permission, RiskLevel> = {
  'filesystem.read': 'low',
  'filesystem.write': 'medium',
  'filesystem.delete': 'high',
  'shell.execute': 'medium',
  'shell.admin': 'critical',
  'browser.control': 'medium',
  'computer.control': 'medium',
  'network.http': 'low',
  'screen.capture': 'medium',
  'camera.use': 'medium',
  'microphone.use': 'medium',
  'email.read': 'medium',
  'email.send': 'high',
  'calendar.read': 'low',
  'calendar.write': 'medium',
  'finance.read': 'medium',
  'finance.trade': 'critical',
  'payments.execute': 'critical',
  'smart_home.control': 'high',
  'robotics.control': 'critical',
  'code.execute': 'medium',
  'process.manage': 'high',
  'system.info': 'low',
  'memory.read': 'low',
  'memory.write': 'low',
  'memory.delete': 'medium',
  'connector.use': 'medium',
  'external.publish': 'high',
  'agent.create': 'low',
  'secrets.read': 'critical',
};

/** Autonomy levels (Spec §11). */
export const AutonomyLevel = z.number().int().min(0).max(5);
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: 'Chat — answers only, no actions',
  1: 'Advisor — recommends actions',
  2: 'Draft — prepares files, messages, plans',
  3: 'Controlled Execution — auto-runs approved low-risk operations',
  4: 'Workflow Autonomy — runs pre-authorized workflows within budgets',
  5: 'Privileged — high-impact operations still require just-in-time approval',
};

export const PolicyDecision = z.enum(['allow', 'deny', 'require_approval']);
export type PolicyDecision = z.infer<typeof PolicyDecision>;

export const PolicyRule = z.object({
  id: z.string(),
  name: z.string(),
  /** Permission or glob like "filesystem.*" */
  permission: z.string(),
  /** Optional resource glob (path prefix, connector id, etc.) */
  resource: z.string().nullable().default(null),
  /** Optional agent id or role; null = any agent */
  agent: z.string().nullable().default(null),
  decision: PolicyDecision,
  /** 'once' | 'workflow:<runId>' | 'always' */
  scope: z.string().default('always'),
  expires_at: z.string().nullable().default(null),
  created_at: z.string(),
});
export type PolicyRule = z.infer<typeof PolicyRule>;
