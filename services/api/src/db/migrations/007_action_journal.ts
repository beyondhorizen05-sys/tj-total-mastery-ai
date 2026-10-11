import type { Migration } from '../migrations.js';
export const m007: Migration = {
  version: 7, name: 'external_action_journal', up: [
    "CREATE TABLE external_action_journal (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('started','completed','uncertain')), result TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    'CREATE INDEX idx_external_action_status ON external_action_journal(status, updated_at)',
  ],
};
