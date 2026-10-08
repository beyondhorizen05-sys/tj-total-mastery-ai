import type { Database } from '../db/database.js';

export class GraphError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type GraphNodeType = 'project' | 'agent' | 'task' | 'memory' | 'conversation' | 'artifact' | 'event';
export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  description: string;
  created_at: string;
  source: string;
  metadata: Record<string, string | number | boolean | null>;
}
export interface GraphEdge { id: string; from: string; to: string; relation: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; limits: { max_nodes: number; max_edges: number; truncated: boolean }; project_id: string | null }

const NODE_LIMIT = 200;
const EDGE_LIMIT = 400;
const clip = (value: unknown, length = 140) => String(value ?? '').slice(0, length);
const key = (type: GraphNodeType, id: string) => `${type}:${id}`;

/** Read-only graph of explicit persisted relationships. No inferred or invented links. */
export class GraphService {
  constructor(private db: Database, private workspaceId: () => string) {}

  build(projectId: string | null = null): GraphData {
    const workspace = this.workspaceId();
    if (projectId && !this.db.get('SELECT id FROM projects WHERE id = ? AND workspace_id = ?', [projectId, workspace])) throw new GraphError('Project not found', 404);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const included = new Set<string>();
    const includedEdges = new Set<string>();
    let truncated = false;
    const addNode = (node: GraphNode) => {
      if (included.has(node.id)) return;
      if (nodes.length >= NODE_LIMIT) { truncated = true; return; }
      nodes.push(node); included.add(node.id);
    };
    const addEdge = (from: string, to: string, relation: string) => {
      if (!included.has(from) || !included.has(to)) return;
      const id = `${from}|${relation}|${to}`;
      if (includedEdges.has(id)) return;
      if (edges.length >= EDGE_LIMIT) { truncated = true; return; }
      edges.push({ id, from, to, relation });
      includedEdges.add(id);
    };
    const projectClause = projectId ? ' AND project_id = ?' : '';
    const scoped = (extra: unknown[] = []) => [workspace, ...(projectId ? [projectId] : []), ...extra];
    const limited = (sql: string, params: unknown[], limit: number) => {
      const rows = this.db.all<any>(`${sql} LIMIT ?`, [...params, limit + 1]);
      if (rows.length > limit) truncated = true;
      return rows.slice(0, limit);
    };

    const projects = limited(`SELECT id, name, description, created_at, status FROM projects WHERE workspace_id = ?${projectId ? ' AND id = ?' : ''} ORDER BY created_at DESC`, scoped(), 35);
    const agents = limited(`SELECT id, name, role, description, project_id, status, created_at FROM agents WHERE workspace_id = ?${projectClause} ORDER BY created_at DESC`, scoped(), 35);
    const tasks = limited(`SELECT id, title, description, project_id, agent_id, parent_task_id, status, created_at FROM tasks WHERE workspace_id = ?${projectClause} ORDER BY created_at DESC`, scoped(), 60);
    const memories = limited(`SELECT id, project_id, agent_id, type, content, source, sensitivity, related_entities, created_at FROM memories WHERE workspace_id = ?${projectClause} AND archived = 0 AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC`, scoped([new Date().toISOString()]), 40);
    const conversations = limited(`SELECT id, title, project_id, created_at FROM conversations WHERE workspace_id = ?${projectClause} ORDER BY created_at DESC`, scoped(), 25);
    const artifacts = limited(`SELECT id, name, kind, path, summary, project_id, task_id, agent_id, created_at FROM artifacts WHERE workspace_id = ?${projectClause} ORDER BY created_at DESC`, scoped(), 30);
    const events = limited(`SELECT id, name, summary, project_id, task_id, agent_id, ts FROM events WHERE project_id ${projectId ? '= ?' : 'IN (SELECT id FROM projects WHERE workspace_id = ?)'} ORDER BY ts DESC`, [projectId ?? workspace], 25);

    for (const row of projects) addNode({ id: key('project', row.id), type: 'project', label: clip(row.name, 80), description: clip(row.description, 500), created_at: row.created_at, source: 'projects', metadata: { status: row.status } });
    for (const row of agents) addNode({ id: key('agent', row.id), type: 'agent', label: clip(row.name, 80), description: clip(row.description, 500), created_at: row.created_at, source: 'agents', metadata: { role: row.role, status: row.status } });
    for (const row of tasks) addNode({ id: key('task', row.id), type: 'task', label: clip(row.title, 80), description: clip(row.description, 500), created_at: row.created_at, source: 'tasks', metadata: { status: row.status } });
    for (const row of memories) addNode({ id: key('memory', row.id), type: 'memory', label: row.sensitivity === 'secret' ? 'Secret memory' : clip(row.content, 80), description: row.sensitivity === 'secret' ? 'Content hidden in graph' : clip(row.content, 500), created_at: row.created_at, source: clip(row.source, 120), metadata: { type: row.type, sensitivity: row.sensitivity } });
    for (const row of conversations) addNode({ id: key('conversation', row.id), type: 'conversation', label: clip(row.title, 80), description: '', created_at: row.created_at, source: 'conversations', metadata: {} });
    for (const row of artifacts) addNode({ id: key('artifact', row.id), type: 'artifact', label: clip(row.name, 80), description: clip(row.summary, 500), created_at: row.created_at, source: 'artifacts', metadata: { kind: row.kind, path: row.path } });
    for (const row of events) addNode({ id: key('event', row.id), type: 'event', label: clip(row.name, 80), description: clip(row.summary, 500), created_at: row.ts, source: 'events', metadata: {} });

    for (const row of agents) if (row.project_id) addEdge(key('agent', row.id), key('project', row.project_id), 'belongs to');
    for (const row of tasks) {
      if (row.project_id) addEdge(key('task', row.id), key('project', row.project_id), 'belongs to');
      if (row.agent_id) addEdge(key('task', row.id), key('agent', row.agent_id), 'assigned to');
      if (row.parent_task_id) addEdge(key('task', row.id), key('task', row.parent_task_id), 'child of');
    }
    for (const row of memories) {
      if (row.project_id) addEdge(key('memory', row.id), key('project', row.project_id), 'about project');
      if (row.agent_id) addEdge(key('memory', row.id), key('agent', row.agent_id), 'owned by');
      let related: unknown = [];
      try { related = JSON.parse(row.related_entities ?? '[]'); } catch { /* malformed old data has no links */ }
      if (Array.isArray(related)) for (const id of related.slice(0, 20)) if (typeof id === 'string' && included.has(id)) addEdge(key('memory', row.id), id, 'explicitly related');
    }
    for (const row of conversations) if (row.project_id) addEdge(key('conversation', row.id), key('project', row.project_id), 'in project');
    for (const row of artifacts) {
      if (row.project_id) addEdge(key('artifact', row.id), key('project', row.project_id), 'in project');
      if (row.task_id) addEdge(key('artifact', row.id), key('task', row.task_id), 'created by task');
      if (row.agent_id) addEdge(key('artifact', row.id), key('agent', row.agent_id), 'created by agent');
    }
    for (const row of events) {
      if (row.project_id) addEdge(key('event', row.id), key('project', row.project_id), 'in project');
      if (row.task_id) addEdge(key('event', row.id), key('task', row.task_id), 'about task');
      if (row.agent_id) addEdge(key('event', row.id), key('agent', row.agent_id), 'about agent');
    }
    const visibleTaskIds = tasks.filter((task) => included.has(key('task', task.id))).map((task) => task.id);
    if (visibleTaskIds.length) {
      const placeholders = visibleTaskIds.map(() => '?').join(',');
      const deps = this.db.all<{ task_id: string; depends_on_task_id: string }>(`SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (${placeholders})`, visibleTaskIds);
      for (const dep of deps) addEdge(key('task', dep.task_id), key('task', dep.depends_on_task_id), 'depends on');
    }
    return { nodes, edges, limits: { max_nodes: NODE_LIMIT, max_edges: EDGE_LIMIT, truncated }, project_id: projectId };
  }
}
