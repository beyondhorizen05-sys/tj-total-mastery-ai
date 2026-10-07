import type { Migration } from '../migrations.js';

export const m001: Migration = {
  version: 1,
  name: 'core',
  up: [
    `CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, locale TEXT NOT NULL DEFAULT 'en-US', time_zone TEXT NOT NULL DEFAULT 'UTC', created_at TEXT NOT NULL)`,
    `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL, data_dir TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', root_path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE conversations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, model_id TEXT, provider_id TEXT, agent_id TEXT, trace TEXT, attachments TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`,
    `CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at)`,
    `CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, ts TEXT NOT NULL, severity TEXT NOT NULL, project_id TEXT, agent_id TEXT, task_id TEXT, workflow_run_id TEXT, conversation_id TEXT, connector_id TEXT, model_id TEXT, summary TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}')`,
    `CREATE INDEX idx_events_ts ON events(ts DESC)`,
    `CREATE INDEX idx_events_name ON events(name)`,
    `CREATE INDEX idx_events_agent ON events(agent_id)`,
    `CREATE INDEX idx_events_task ON events(task_id)`,
    `CREATE TABLE audit_log (id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, agent_id TEXT, action TEXT NOT NULL, permission TEXT, resource TEXT, decision TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}')`,
    `CREATE INDEX idx_audit_ts ON audit_log(ts DESC)`,
    `CREATE TABLE notifications (id TEXT PRIMARY KEY, ts TEXT NOT NULL, level TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, link TEXT)`,
    `CREATE TABLE metrics (id TEXT PRIMARY KEY, ts TEXT NOT NULL, name TEXT NOT NULL, value REAL NOT NULL, tags TEXT NOT NULL DEFAULT '{}')`,
    `CREATE INDEX idx_metrics_name_ts ON metrics(name, ts DESC)`,
  ],
};
