import type { Migration } from '../migrations.js';

export const m002: Migration = {
  version: 2,
  name: 'models_and_secrets',
  up: [
    `CREATE TABLE model_providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, preset TEXT, base_url TEXT, organization TEXT, credential_ref TEXT, requires_api_key INTEGER NOT NULL, privacy_class TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, health TEXT NOT NULL DEFAULT 'unknown', last_checked_at TEXT, last_error TEXT, avg_latency_ms REAL, created_at TEXT NOT NULL)`,
    `CREATE TABLE models (id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE, model TEXT NOT NULL, display_name TEXT NOT NULL, modalities TEXT NOT NULL, supports_tools INTEGER NOT NULL, supports_streaming INTEGER NOT NULL, supports_vision INTEGER NOT NULL, context_length INTEGER, speed_class TEXT NOT NULL, quality_class TEXT NOT NULL, cost_class TEXT NOT NULL, privacy_class TEXT NOT NULL, price_in_per_m REAL, price_out_per_m REAL, available INTEGER NOT NULL DEFAULT 1, health TEXT NOT NULL DEFAULT 'unknown', avg_latency_ms REAL, success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0, discovered_at TEXT NOT NULL)`,
    `CREATE TABLE secrets (ref TEXT PRIMARY KEY, scope TEXT NOT NULL, label TEXT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL, created_at TEXT NOT NULL, rotated_at TEXT, expires_at TEXT, last_accessed_at TEXT, access_count INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE secret_access_log (id TEXT PRIMARY KEY, ref TEXT NOT NULL, ts TEXT NOT NULL, accessor TEXT NOT NULL, purpose TEXT NOT NULL)`,
    `CREATE TABLE usage (id TEXT PRIMARY KEY, ts TEXT NOT NULL, model_id TEXT NOT NULL, provider_id TEXT NOT NULL, project_id TEXT, agent_id TEXT, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, cost_usd REAL, latency_ms REAL NOT NULL, success INTEGER NOT NULL)`,
    `CREATE INDEX idx_usage_ts ON usage(ts DESC)`,
  ],
};
