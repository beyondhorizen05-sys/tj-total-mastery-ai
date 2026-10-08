import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { GraphService } from '../src/graph/service.js';
import { registerGraphRoutes } from '../src/server/routes/graph.js';

describe('persisted knowledge graph', () => {
  let dir: string;
  let db: Database;
  let graph: GraphService;
  const ts = '2026-10-08T00:00:00.000Z';

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-graph-'));
    db = new Database(path.join(dir, 'graph.sqlite'));
    db.migrate();
    graph = new GraphService(db, () => 'default');
    db.run('INSERT INTO projects (id, workspace_id, name, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['p1', 'default', 'Main', dir, ts, ts]);
    db.run('INSERT INTO projects (id, workspace_id, name, root_path, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['p2', 'other', 'Other workspace', dir, ts, ts]);
    db.run('INSERT INTO agents (id, workspace_id, project_id, name, role, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['a1', 'default', 'p1', 'Builder', 'developer', ts, ts]);
    db.run('INSERT INTO tasks (id, workspace_id, project_id, agent_id, title, created_at) VALUES (?,?,?,?,?,?)', ['t1', 'default', 'p1', 'a1', 'Build UI', ts]);
    db.run('INSERT INTO tasks (id, workspace_id, project_id, agent_id, title, created_at) VALUES (?,?,?,?,?,?)', ['t2', 'default', 'p1', 'a1', 'Verify UI', ts]);
    db.run('INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?,?)', ['t2', 't1']);
    db.run('INSERT INTO memories (id, workspace_id, project_id, type, content, source, owner, sensitivity, related_entities, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', ['m1', 'default', 'p1', 'fact', 'UI should glow', 'user', 'user', 'private', '["task:t1"]', ts, ts]);
    db.run('INSERT INTO memories (id, workspace_id, project_id, type, content, source, owner, sensitivity, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', ['m2', 'default', 'p1', 'fact', 'Top secret', 'user', 'user', 'secret', ts, ts]);
    db.run('INSERT INTO conversations (id, workspace_id, project_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['c1', 'default', 'p1', 'UI discussion', ts, ts]);
    db.run('INSERT INTO artifacts (id, workspace_id, project_id, task_id, kind, name, path, created_at) VALUES (?,?,?,?,?,?,?,?)', ['f1', 'default', 'p1', 't1', 'file', 'app.tsx', path.join(dir, 'app.tsx'), ts]);
    db.run('INSERT INTO events (id, name, ts, severity, project_id, task_id, summary) VALUES (?,?,?,?,?,?,?)', ['e1', 'task.completed', ts, 'info', 'p1', 't1', 'UI task completed']);
    db.run('INSERT INTO events (id, name, ts, severity, project_id, summary) VALUES (?,?,?,?,?,?)', ['e2', 'task.completed', ts, 'info', 'p2', 'Other workspace activity']);
  });

  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('shows only real relations and redacts secret memory text', () => {
    const result = graph.build('p1');
    expect(result.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['project:p1', 'agent:a1', 'task:t1', 'memory:m1', 'memory:m2', 'conversation:c1', 'artifact:f1', 'event:e1']));
    expect(result.nodes.some((node) => node.id === 'project:p2' || node.id === 'event:e2')).toBe(false);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'task:t1', to: 'agent:a1', relation: 'assigned to' }),
      expect.objectContaining({ from: 'task:t2', to: 'task:t1', relation: 'depends on' }),
      expect.objectContaining({ from: 'memory:m1', to: 'task:t1', relation: 'explicitly related' }),
      expect.objectContaining({ from: 'artifact:f1', to: 'task:t1', relation: 'created by task' }),
    ]));
    expect(JSON.stringify(result)).not.toContain('Top secret');
    expect(JSON.stringify(result)).not.toContain('Other workspace activity');
  });

  it('rejects another workspace project and bounds the graph', () => {
    expect(() => graph.build('p2')).toThrow('Project not found');
    for (let index = 0; index < 100; index++) db.run('INSERT INTO tasks (id, workspace_id, project_id, title, created_at) VALUES (?,?,?,?,?)', [`extra-${index}`, 'default', 'p1', `Task ${index}`, ts]);
    const result = graph.build();
    expect(result.limits.truncated).toBe(true);
    expect(result.nodes.length).toBeLessThanOrEqual(result.limits.max_nodes);
    expect(result.edges.length).toBeLessThanOrEqual(result.limits.max_edges);
    expect(result.edges.every((edge) => result.nodes.some((node) => node.id === edge.from) && result.nodes.some((node) => node.id === edge.to))).toBe(true);
    expect(result.nodes.some((node) => node.id === 'project:p2')).toBe(false);
  });

  it('counts each explicit relationship only once when saved related entities repeat', () => {
    db.run('UPDATE memories SET related_entities = ? WHERE id = ?', ['["task:t1","task:t1","task:t1"]', 'm1']);
    const result = graph.build('p1');
    expect(result.edges.filter((edge) => edge.from === 'memory:m1' && edge.to === 'task:t1' && edge.relation === 'explicitly related')).toHaveLength(1);
    expect(new Set(result.edges.map((edge) => edge.id)).size).toBe(result.edges.length);
  });

  it('serves project-scoped graph through read-only API', async () => {
    const app = Fastify();
    registerGraphRoutes(app, { graph });
    try {
      const ok = await app.inject({ method: 'GET', url: '/api/v1/graph?project_id=p1' });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().project_id).toBe('p1');
      const missing = await app.inject({ method: 'GET', url: '/api/v1/graph?project_id=p2' });
      expect(missing.statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
