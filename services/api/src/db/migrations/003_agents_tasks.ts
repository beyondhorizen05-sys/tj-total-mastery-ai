import type { Migration } from '../migrations.js';

export const m003: Migration = {
  version: 3,
  name: 'agents_tasks',
  up: [
    `CREATE TABLE agents (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, template_id TEXT, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', avatar TEXT NOT NULL DEFAULT '🤖', personality TEXT NOT NULL DEFAULT '', system_instructions TEXT NOT NULL DEFAULT '', provider_id TEXT, model_id TEXT, capabilities TEXT NOT NULL DEFAULT '[]', tools TEXT NOT NULL DEFAULT '[]', connectors TEXT NOT NULL DEFAULT '[]', permissions TEXT NOT NULL DEFAULT '[]', memory_scope TEXT NOT NULL DEFAULT 'project', objectives TEXT NOT NULL DEFAULT '[]', current_task_id TEXT, status TEXT NOT NULL DEFAULT 'idle', confidence REAL, budget_usd REAL, spent_usd REAL NOT NULL DEFAULT 0, metrics TEXT NOT NULL DEFAULT '{"tasks_completed":0,"tasks_failed":0,"tool_calls":0,"tokens":0}', town_area TEXT NOT NULL DEFAULT 'command_center', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE agent_messages (id TEXT PRIMARY KEY, ts TEXT NOT NULL, from_agent_id TEXT, to_agent_id TEXT, kind TEXT NOT NULL, task_id TEXT, project_id TEXT, content TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}')`,
    `CREATE INDEX idx_agent_messages_ts ON agent_messages(ts DESC)`,
    `CREATE TABLE tasks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, workflow_run_id TEXT, parent_task_id TEXT, agent_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 3, risk TEXT NOT NULL DEFAULT 'low', progress REAL NOT NULL DEFAULT 0, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT)`,
    `CREATE INDEX idx_tasks_status ON tasks(status)`,
    `CREATE INDEX idx_tasks_project ON tasks(project_id)`,
    `CREATE TABLE task_dependencies (task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY (task_id, depends_on_task_id))`,
    `CREATE TABLE plans (id TEXT PRIMARY KEY, project_id TEXT, conversation_id TEXT, goal TEXT NOT NULL, plan TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE artifacts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, task_id TEXT, agent_id TEXT, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT, mime TEXT, size_bytes INTEGER, checksum TEXT, summary TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
    `CREATE INDEX idx_artifacts_project ON artifacts(project_id)`,
  ],
};
