import type { Migration } from '../migrations.js';

export const m006: Migration = {
  version: 6,
  name: 'connectors_devices_files',
  up: [
    `CREATE TABLE connector_configs (connector_id TEXT PRIMARY KEY, config TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1, health TEXT NOT NULL DEFAULT 'unknown', last_error TEXT, last_checked_at TEXT, updated_at TEXT NOT NULL)`,
    `CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, connector_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT '{}', permissions_granted TEXT NOT NULL DEFAULT '[]', last_seen_at TEXT)`,
    `CREATE TABLE file_versions (id TEXT PRIMARY KEY, path TEXT NOT NULL, backup_path TEXT NOT NULL, checksum TEXT NOT NULL, size_bytes INTEGER NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL)`,
    `CREATE INDEX idx_file_versions_path ON file_versions(path, created_at DESC)`,
    `CREATE TABLE api_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, headers TEXT NOT NULL DEFAULT '{}', body TEXT, response_status INTEGER, response_headers TEXT, response_body TEXT, duration_ms REAL, created_at TEXT NOT NULL)`,
    `CREATE TABLE research_notes (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, query TEXT NOT NULL, source_title TEXT NOT NULL, source_url TEXT, retrieved_at TEXT NOT NULL, excerpt TEXT NOT NULL, kind TEXT NOT NULL, confidence REAL NOT NULL, created_at TEXT NOT NULL)`,
  ],
};
