import { z } from 'zod';
import { HealthState, CapabilityStatus } from '../status.js';
import { Permission } from '../permissions.js';
import { ISO, JSONRecord } from './core.js';

export const Approval = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  task_id: z.string().nullable(),
  workflow_run_id: z.string().nullable(),
  action: z.string(),
  target: z.string(),
  why: z.string(),
  tools: z.array(z.string()),
  resources_affected: z.array(z.string()),
  estimated_cost: z.string().nullable(),
  risks: z.array(z.string()),
  rollback_available: z.boolean(),
  permission: z.string(),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['pending', 'approved', 'approved_workflow', 'denied', 'expired', 'edited']),
  decided_at: ISO.nullable(),
  decided_by: z.string().nullable(),
  payload: JSONRecord.default({}),
  created_at: ISO,
});
export type Approval = z.infer<typeof Approval>;

export const ConnectorAction = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  input_schema: JSONRecord,
  risk: z.enum(['low', 'medium', 'high', 'critical']),
});
export type ConnectorAction = z.infer<typeof ConnectorAction>;

export const ConnectorConfigField = z.object({
  key: z.string(),
  label: z.string(),
  secret: z.boolean(),
  required: z.boolean(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
});

export const Connector = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  provider: z.string(),
  description: z.string(),
  category: z.string(),
  auth_scheme: z.enum(['none', 'api_key', 'bearer', 'basic', 'oauth2', 'local_socket', 'cli', 'ssh', 'custom']),
  scopes: z.array(z.string()),
  permissions: z.array(Permission),
  actions: z.array(ConnectorAction),
  triggers: z.array(z.object({ id: z.string(), name: z.string(), description: z.string() })),
  privacy: z.string(),
  config_fields: z.array(ConnectorConfigField),
  docs_url: z.string().nullable(),
  version: z.string(),
  rate_limit: z.string().nullable(),
  /** runtime */
  status: CapabilityStatus,
  health: HealthState,
  last_error: z.string().nullable(),
  last_checked_at: ISO.nullable(),
  configured_keys: z.array(z.string()),
  missing: z.string().nullable(),
});
export type Connector = z.infer<typeof Connector>;

export const Artifact = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  task_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  kind: z.enum(['file', 'report', 'code', 'image', 'audio', 'dataset', 'diff', 'log', 'other']),
  name: z.string(),
  path: z.string().nullable(),
  mime: z.string().nullable(),
  size_bytes: z.number().nullable(),
  checksum: z.string().nullable(),
  summary: z.string().default(''),
  created_at: ISO,
});
export type Artifact = z.infer<typeof Artifact>;

export const AuditLog = z.object({
  id: z.string(),
  ts: ISO,
  actor: z.string(),
  agent_id: z.string().nullable(),
  action: z.string(),
  permission: z.string().nullable(),
  resource: z.string().nullable(),
  decision: z.string(),
  details: JSONRecord.default({}),
});
export type AuditLog = z.infer<typeof AuditLog>;

export const Notification = z.object({
  id: z.string(),
  ts: ISO,
  level: z.enum(['info', 'success', 'warning', 'error']),
  title: z.string(),
  body: z.string(),
  read: z.boolean().default(false),
  link: z.string().nullable(),
});
export type Notification = z.infer<typeof Notification>;

export const Device = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  connector_id: z.string(),
  state: JSONRecord.default({}),
  permissions_granted: z.array(z.string()).default([]),
  last_seen_at: ISO.nullable(),
});
export type Device = z.infer<typeof Device>;

export const Metric = z.object({
  id: z.string(),
  ts: ISO,
  name: z.string(),
  value: z.number(),
  tags: z.record(z.string(), z.string()).default({}),
});
export type Metric = z.infer<typeof Metric>;
