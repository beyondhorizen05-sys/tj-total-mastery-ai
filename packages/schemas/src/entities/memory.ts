import { z } from 'zod';
import { ISO, JSONRecord } from './core.js';

export const MemoryType = z.enum(['working', 'conversation', 'episodic', 'semantic', 'procedural', 'preference', 'project', 'agent', 'prospective', 'spatial']);
export type MemoryType = z.infer<typeof MemoryType>;

export const Memory = z.object({
  id: z.string(),
  workspace_id: z.string(),
  project_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  type: MemoryType,
  content: z.string(),
  source: z.string(),
  owner: z.string(),
  confidence: z.number().min(0).max(1),
  provenance: JSONRecord.default({}),
  sensitivity: z.enum(['public', 'internal', 'private', 'secret']).default('private'),
  retention: z.enum(['session', 'short', 'long', 'permanent']).default('long'),
  related_entities: z.array(z.string()).default([]),
  has_embedding: z.boolean().default(false),
  embedding_model: z.string().nullable(),
  version: z.number().default(1),
  archived: z.boolean().default(false),
  created_at: ISO,
  updated_at: ISO,
  expires_at: ISO.nullable(),
});
export type Memory = z.infer<typeof Memory>;

export const EntityType = z.enum(['person', 'project', 'company', 'file', 'idea', 'task', 'event', 'conversation', 'concept', 'agent', 'tool', 'other']);

export const Entity = z.object({
  id: z.string(),
  workspace_id: z.string(),
  type: EntityType,
  name: z.string(),
  attributes: JSONRecord.default({}),
  created_at: ISO,
  updated_at: ISO,
});
export type Entity = z.infer<typeof Entity>;

export const EntityRelation = z.object({
  id: z.string(),
  from_id: z.string(),
  to_id: z.string(),
  relation: z.string(),
  weight: z.number().default(1),
  source_memory_id: z.string().nullable(),
  created_at: ISO,
});
export type EntityRelation = z.infer<typeof EntityRelation>;

export const MemorySearchHit = z.object({
  memory: Memory,
  score: z.number(),
  /** which retrieval paths matched: 'keyword' | 'semantic' */
  matched_by: z.array(z.string()),
});
export type MemorySearchHit = z.infer<typeof MemorySearchHit>;
