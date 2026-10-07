import type { Migration } from '../migrations.js';

export const m004: Migration = {
  version: 4,
  name: 'workflows_automations_approvals',
  up: [
    `CREATE TABLE workflows (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1, steps TEXT NOT NULL, inputs_schema TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE workflow_versions (workflow_id TEXT NOT NULL, version INTEGER NOT NULL, steps TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (workflow_id, version))`,
    `CREATE TABLE workflow_runs (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, workflow_version INTEGER NOT NULL, project_id TEXT, status TEXT NOT NULL, inputs TEXT NOT NULL DEFAULT '{}', step_state TEXT NOT NULL DEFAULT '{}', checkpoint TEXT NOT NULL DEFAULT '{}', error TEXT, triggered_by TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT)`,
    `CREATE INDEX idx_runs_status ON workflow_runs(status)`,
    `CREATE TABLE automations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, trigger TEXT NOT NULL, workflow_id TEXT NOT NULL, last_run_at TEXT, next_run_at TEXT, run_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE automation_runs (id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, workflow_run_id TEXT, ts TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE approvals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, agent_id TEXT, task_id TEXT, workflow_run_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL, why TEXT NOT NULL, tools TEXT NOT NULL DEFAULT '[]', resources_affected TEXT NOT NULL DEFAULT '[]', estimated_cost TEXT, risks TEXT NOT NULL DEFAULT '[]', rollback_available INTEGER NOT NULL DEFAULT 0, permission TEXT NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decided_at TEXT, decided_by TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)`,
    `CREATE INDEX idx_approvals_status ON approvals(status)`,
    `CREATE TABLE policies (id TEXT PRIMARY KEY, name TEXT NOT NULL, permission TEXT NOT NULL, resource TEXT, agent TEXT, decision TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'always', expires_at TEXT, created_at TEXT NOT NULL)`,
  ],
};
