import type { Migration } from '../migrations.js';

export const m005: Migration = {
  version: 5,
  name: 'memory_knowledge',
  up: [
    `CREATE TABLE memories (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT, agent_id TEXT, type TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL, owner TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 1, provenance TEXT NOT NULL DEFAULT '{}', sensitivity TEXT NOT NULL DEFAULT 'private', retention TEXT NOT NULL DEFAULT 'long', related_entities TEXT NOT NULL DEFAULT '[]', has_embedding INTEGER NOT NULL DEFAULT 0, embedding_model TEXT, embedding BLOB, version INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT)`,
    `CREATE INDEX idx_memories_type ON memories(type)`,
    `CREATE INDEX idx_memories_project ON memories(project_id)`,
    `CREATE TABLE memory_versions (memory_id TEXT NOT NULL, version INTEGER NOT NULL, content TEXT NOT NULL, changed_at TEXT NOT NULL, PRIMARY KEY (memory_id, version))`,
    `CREATE VIRTUAL TABLE memories_fts USING fts5(content, memory_id UNINDEXED)`,
    `CREATE TABLE entities (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, attributes TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE UNIQUE INDEX idx_entities_type_name ON entities(workspace_id, type, name)`,
    `CREATE TABLE entity_relations (id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, to_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE, relation TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1, source_memory_id TEXT, created_at TEXT NOT NULL)`,
    `CREATE INDEX idx_rel_from ON entity_relations(from_id)`,
    `CREATE INDEX idx_rel_to ON entity_relations(to_id)`,
  ],
};
