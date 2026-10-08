import { z } from 'zod';

/** Universal event names (Spec §62). Extend by convention `<domain>.<verb>`. */
export const EVENT_NAMES = [
  'conversation.created',
  'message.created',
  'message.delta',
  'message.completed',
  'agent.created',
  'agent.updated',
  'agent.deleted',
  'agent.started',
  'agent.message',
  'agent.completed',
  'agent.failed',
  'task.created',
  'task.started',
  'task.progress',
  'task.failed',
  'task.completed',
  'task.cancelled',
  'workflow.created',
  'workflow.started',
  'workflow.step',
  'workflow.paused',
  'workflow.resumed',
  'workflow.retrying',
  'workflow.failed',
  'workflow.cancelled',
  'workflow.completed',
  'approval.requested',
  'approval.granted',
  'approval.denied',
  'permission.denied',
  'tool.called',
  'tool.completed',
  'tool.failed',
  'model.selected',
  'model.fallback',
  'provider.error',
  'connector.connected',
  'connector.disconnected',
  'connector.called',
  'connector.error',
  'memory.created',
  'memory.updated',
  'memory.deleted',
  'artifact.created',
  'automation.fired',
  'automation.completed',
  'automation.failed',
  'project.created',
  'system.health_changed',
  'system.state_changed',
  'system.persona_changed',
  'system.settings_changed',
  'system.stop_all',
  'security.event',
  'audit.logged',
  'notification.created',
  'voice.listening',
  'voice.speaking',
  'voice.stopped',
  'voice.transcript',
  'voice.response',
  'voice.error',
] as const;

export const EventName = z.enum(EVENT_NAMES);
export type EventName = z.infer<typeof EventName>;

export const EventSeverity = z.enum(['debug', 'info', 'warning', 'error', 'critical']);
export type EventSeverity = z.infer<typeof EventSeverity>;

export const TJEvent = z.object({
  id: z.string(),
  name: EventName,
  ts: z.string(),
  severity: EventSeverity.default('info'),
  /** Correlation fields for Activity Stream filtering (Spec §51) */
  project_id: z.string().nullable().default(null),
  agent_id: z.string().nullable().default(null),
  task_id: z.string().nullable().default(null),
  workflow_run_id: z.string().nullable().default(null),
  conversation_id: z.string().nullable().default(null),
  connector_id: z.string().nullable().default(null),
  model_id: z.string().nullable().default(null),
  summary: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type TJEvent = z.infer<typeof TJEvent>;

/** Structured agent-to-agent message kinds (Spec §8). */
export const AgentMessageKind = z.enum([
  'request',
  'response',
  'delegation',
  'critique',
  'evidence',
  'proposal',
  'vote',
  'alert',
  'progress',
  'result',
]);
export type AgentMessageKind = z.infer<typeof AgentMessageKind>;
