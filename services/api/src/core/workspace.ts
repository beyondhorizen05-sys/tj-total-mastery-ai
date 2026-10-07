import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Artifact, Conversation, Message, Project } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { EventBus } from './event-bus.js';
import { uuid, now } from './ids.js';
import { J, mapRow } from '../db/repo.js';

/** User, workspace, projects, conversations/messages and artifacts. */
export class WorkspaceService {
  workspaceId = '';
  userId = '';
  constructor(private db: Database, private bus: EventBus, private projectsDir: string, private dataDir: string) {}

  /** Ensure a default local user + workspace exist (first launch). */
  init() {
    let ws = this.db.get<any>('SELECT * FROM workspaces LIMIT 1');
    if (!ws) {
      const uid = uuid(), wid = uuid(), ts = now();
      const loc = Intl.DateTimeFormat().resolvedOptions();
      this.db.run('INSERT INTO users (id, display_name, locale, time_zone, created_at) VALUES (?,?,?,?,?)', [uid, 'You', loc.locale, loc.timeZone, ts]);
      this.db.run('INSERT INTO workspaces (id, name, owner_id, data_dir, created_at) VALUES (?,?,?,?,?)', [wid, 'Personal', uid, this.dataDir, ts]);
      ws = this.db.get<any>('SELECT * FROM workspaces WHERE id = ?', [wid]);
    }
    this.workspaceId = ws.id; this.userId = ws.owner_id;
    return ws;
  }

  user() { return this.db.get<any>('SELECT * FROM users WHERE id = ?', [this.userId]); }
  setUser(p: { display_name?: string; locale?: string; time_zone?: string }) {
    for (const k of ['display_name', 'locale', 'time_zone'] as const) if (p[k]) this.db.run(`UPDATE users SET ${k} = ? WHERE id = ?`, [p[k], this.userId]);
  }

  // ---- projects ----
  createProject(name: string, description = ''): Project {
    const id = uuid(), ts = now();
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
    const root = path.join(this.projectsDir, `${slug}-${id.slice(0, 6)}`);
    fs.mkdirSync(root, { recursive: true });
    this.db.run('INSERT INTO projects (id, workspace_id, name, description, root_path, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, this.workspaceId, name, description, root, 'active', ts, ts]);
    this.bus.emit({ name: 'project.created', summary: `Project created: ${name}`, project_id: id, data: { root } });
    return this.getProject(id)!;
  }
  getProject(id: string): Project | undefined { return this.db.get<Project>('SELECT * FROM projects WHERE id = ?', [id]); }
  listProjects(): Project[] { return this.db.all<Project>('SELECT * FROM projects ORDER BY updated_at DESC'); }
  setProjectStatus(id: string, status: Project['status']) { this.db.run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', [status, now(), id]); }

  // ---- conversations ----
  createConversation(title = 'New conversation', projectId: string | null = null): Conversation {
    const id = uuid(), ts = now();
    this.db.run('INSERT INTO conversations (id, workspace_id, project_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)', [id, this.workspaceId, projectId, title, ts, ts]);
    this.bus.emit({ name: 'conversation.created', summary: `Conversation: ${title}`, conversation_id: id, project_id: projectId });
    return this.getConversation(id)!;
  }
  getConversation(id: string): Conversation | undefined { return this.db.get<Conversation>('SELECT * FROM conversations WHERE id = ?', [id]); }
  listConversations(limit = 100): Conversation[] { return this.db.all<Conversation>('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?', [limit]); }
  deleteConversation(id: string) { this.db.run('DELETE FROM conversations WHERE id = ?', [id]); }
  renameConversation(id: string, title: string) { this.db.run('UPDATE conversations SET title = ? WHERE id = ?', [title, id]); }

  // ---- messages ----
  addMessage(m: { conversation_id: string; role: Message['role']; content: string; model_id?: string | null; provider_id?: string | null; agent_id?: string | null; trace?: Message['trace']; attachments?: Message['attachments'] }): Message {
    const id = uuid(), ts = now();
    this.db.run('INSERT INTO messages (id, conversation_id, role, content, model_id, provider_id, agent_id, trace, attachments, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, m.conversation_id, m.role, m.content, m.model_id ?? null, m.provider_id ?? null, m.agent_id ?? null, m.trace ? J.str(m.trace) : null, J.str(m.attachments ?? []), ts]);
    this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [ts, m.conversation_id]);
    this.bus.emit({ name: 'message.created', severity: 'debug', summary: `${m.role} message`, conversation_id: m.conversation_id, data: { message_id: id, role: m.role } });
    return this.getMessage(id)!;
  }
  getMessage(id: string): Message | undefined {
    const r = this.db.get<any>('SELECT * FROM messages WHERE id = ?', [id]);
    return r ? mapRow<Message>(r, ['trace', 'attachments']) : undefined;
  }
  messages(conversationId: string, limit = 500): Message[] {
    return this.db.all<any>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?', [conversationId, limit]).map((r) => mapRow<Message>(r, ['trace', 'attachments']));
  }

  // ---- artifacts ----
  addArtifact(a: { project_id?: string | null; task_id?: string | null; agent_id?: string | null; kind: Artifact['kind']; name: string; path?: string | null; summary?: string }): Artifact {
    const id = uuid();
    let size: number | null = null, sum: string | null = null;
    if (a.path && fs.existsSync(a.path) && fs.statSync(a.path).isFile()) {
      const b = fs.readFileSync(a.path);
      size = b.length; sum = crypto.createHash('sha256').update(b).digest('hex');
    }
    this.db.run('INSERT INTO artifacts (id, workspace_id, project_id, task_id, agent_id, kind, name, path, mime, size_bytes, checksum, summary, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, this.workspaceId, a.project_id ?? null, a.task_id ?? null, a.agent_id ?? null, a.kind, a.name, a.path ?? null, null, size, sum, a.summary ?? '', now()]);
    this.bus.emit({ name: 'artifact.created', summary: `Artifact: ${a.name}`, project_id: a.project_id, task_id: a.task_id, agent_id: a.agent_id, data: { artifact_id: id, path: a.path } });
    return this.db.get<Artifact>('SELECT * FROM artifacts WHERE id = ?', [id])!;
  }
  artifacts(projectId?: string): Artifact[] {
    return projectId
      ? this.db.all<Artifact>('SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC', [projectId])
      : this.db.all<Artifact>('SELECT * FROM artifacts ORDER BY created_at DESC LIMIT 200');
  }
}
