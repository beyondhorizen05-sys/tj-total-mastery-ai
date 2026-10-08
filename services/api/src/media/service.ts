import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../db/database.js';

const formats: Record<string, { extension: string; kind: 'image' | 'audio' | 'video'; valid: (data: Buffer) => boolean }> = {
  'image/png': { extension: '.png', kind: 'image', valid: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  'image/jpeg': { extension: '.jpg', kind: 'image', valid: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/gif': { extension: '.gif', kind: 'image', valid: (b) => ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) },
  'image/webp': { extension: '.webp', kind: 'image', valid: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'audio/mpeg': { extension: '.mp3', kind: 'audio', valid: (b) => b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  'audio/wav': { extension: '.wav', kind: 'audio', valid: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE' },
  'audio/ogg': { extension: '.ogg', kind: 'audio', valid: (b) => b.toString('ascii', 0, 4) === 'OggS' },
  'video/mp4': { extension: '.mp4', kind: 'video', valid: (b) => b.toString('ascii', 4, 8) === 'ftyp' },
  'video/webm': { extension: '.webm', kind: 'video', valid: (b) => b.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) },
};
const maxAssetBytes = 8 * 1024 * 1024;
const maxLibraryBytes = 512 * 1024 * 1024;
const itemTypes = new Set(['music', 'movie', 'podcast', 'book', 'game', 'video', 'image', 'other']);
const itemStatuses = new Set(['planned', 'in_progress', 'completed', 'archived']);
const projectStatuses = new Set(['idea', 'active', 'completed', 'archived']);

export interface MediaItem {
  id: string; title: string; type: string; creator: string; notes: string; status: string;
  asset_id: string | null; created_at: string; updated_at: string;
}
export interface MediaProject { id: string; title: string; brief: string; status: string; created_at: string; updated_at: string }
export interface MediaAsset {
  id: string; filename: string; mime_type: string; kind: string; bytes: number;
  project_id: string | null; created_at: string;
}
export interface MediaCollection { id: string; name: string; description: string; item_count: number; created_at: string }

function boundedText(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label} is required`);
  if (trimmed.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return trimmed;
}

export class MediaLibrary {
  constructor(private db: Database, private storageDir: string) {
    fs.mkdirSync(storageDir, { recursive: true });
    db.exec(`CREATE TABLE IF NOT EXISTS media_projects (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY, filename TEXT NOT NULL, mime_type TEXT NOT NULL, kind TEXT NOT NULL,
      bytes INTEGER NOT NULL, storage_name TEXT NOT NULL, project_id TEXT REFERENCES media_projects(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT NOT NULL, creator TEXT NOT NULL,
      notes TEXT NOT NULL, status TEXT NOT NULL, asset_id TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_collections (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS media_collection_items (
      collection_id TEXT NOT NULL REFERENCES media_collections(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      PRIMARY KEY (collection_id, item_id));`);
  }

  saveItem(input: Partial<MediaItem> & Pick<MediaItem, 'title' | 'type'>): MediaItem {
    const title = boundedText(input.title, 'Title', 200, true);
    if (!itemTypes.has(input.type)) throw new Error('Unsupported media type');
    const creator = boundedText(input.creator ?? '', 'Creator', 200);
    const notes = boundedText(input.notes ?? '', 'Notes', 4000);
    const status = input.status ?? 'planned';
    if (!itemStatuses.has(status)) throw new Error('Unsupported list status');
    if (input.asset_id && !this.getAsset(input.asset_id)) throw new Error('Asset not found');
    const existing = input.id ? this.getItem(input.id) : null;
    if (input.id && !existing) throw new Error('Media item not found');
    const id = existing?.id ?? crypto.randomUUID();
    const timestamp = new Date().toISOString();
    this.db.run(`INSERT INTO media_items (id,title,type,creator,notes,status,asset_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,type=excluded.type,creator=excluded.creator,
      notes=excluded.notes,status=excluded.status,asset_id=excluded.asset_id,updated_at=excluded.updated_at`,
      [id, title, input.type, creator, notes, status, input.asset_id ?? null, existing?.created_at ?? timestamp, timestamp]);
    return this.getItem(id)!;
  }
  getItem(id: string): MediaItem | null { return this.db.get<MediaItem>('SELECT * FROM media_items WHERE id=?', [id]) ?? null; }
  listItems(query: { q?: string; type?: string; status?: string } = {}): MediaItem[] {
    const where: string[] = []; const args: unknown[] = [];
    if (query.q) {
      const q = boundedText(query.q, 'Search', 100).replace(/[\\%_]/g, (value) => `\\${value}`);
      where.push("(title LIKE ? ESCAPE '\\' OR creator LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')");
      args.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (query.type) { if (!itemTypes.has(query.type)) throw new Error('Unsupported media type'); where.push('type=?'); args.push(query.type); }
    if (query.status) { if (!itemStatuses.has(query.status)) throw new Error('Unsupported list status'); where.push('status=?'); args.push(query.status); }
    return this.db.all<MediaItem>(`SELECT * FROM media_items ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 200`, args);
  }
  deleteItem(id: string): boolean { return this.db.run('DELETE FROM media_items WHERE id=?', [id]).changes > 0; }

  saveProject(input: Partial<MediaProject> & Pick<MediaProject, 'title'>): MediaProject {
    const title = boundedText(input.title, 'Project title', 200, true);
    const brief = boundedText(input.brief ?? '', 'Creative brief', 10_000);
    const status = input.status ?? 'idea';
    if (!projectStatuses.has(status)) throw new Error('Unsupported project status');
    const existing = input.id ? this.getProject(input.id) : null;
    if (input.id && !existing) throw new Error('Creative project not found');
    const id = existing?.id ?? crypto.randomUUID(); const timestamp = new Date().toISOString();
    this.db.run(`INSERT INTO media_projects (id,title,brief,status,created_at,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,brief=excluded.brief,status=excluded.status,updated_at=excluded.updated_at`,
    [id, title, brief, status, existing?.created_at ?? timestamp, timestamp]);
    return this.getProject(id)!;
  }
  getProject(id: string): MediaProject | null { return this.db.get<MediaProject>('SELECT * FROM media_projects WHERE id=?', [id]) ?? null; }
  projects(): MediaProject[] { return this.db.all<MediaProject>('SELECT * FROM media_projects ORDER BY updated_at DESC LIMIT 200'); }

  createCollection(input: { name: string; description?: string }): MediaCollection {
    const name = boundedText(input.name, 'Collection name', 120, true);
    const description = boundedText(input.description ?? '', 'Description', 1000);
    const id = crypto.randomUUID(); const timestamp = new Date().toISOString();
    this.db.run('INSERT INTO media_collections (id,name,description,created_at) VALUES (?,?,?,?)', [id, name, description, timestamp]);
    return { id, name, description, item_count: 0, created_at: timestamp };
  }
  collections(): MediaCollection[] {
    return this.db.all<MediaCollection>(`SELECT c.*, COUNT(ci.item_id) AS item_count FROM media_collections c
      LEFT JOIN media_collection_items ci ON ci.collection_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 200`);
  }
  collectionItems(id: string): MediaItem[] {
    if (!this.db.get('SELECT id FROM media_collections WHERE id=?', [id])) throw new Error('Collection not found');
    return this.db.all<MediaItem>('SELECT i.* FROM media_items i JOIN media_collection_items ci ON ci.item_id=i.id WHERE ci.collection_id=? ORDER BY i.updated_at DESC', [id]);
  }
  addToCollection(collectionId: string, itemId: string): void {
    if (!this.db.get('SELECT id FROM media_collections WHERE id=?', [collectionId])) throw new Error('Collection not found');
    if (!this.getItem(itemId)) throw new Error('Media item not found');
    this.db.run('INSERT OR IGNORE INTO media_collection_items (collection_id,item_id) VALUES (?,?)', [collectionId, itemId]);
  }
  removeFromCollection(collectionId: string, itemId: string): boolean {
    return this.db.run('DELETE FROM media_collection_items WHERE collection_id=? AND item_id=?', [collectionId, itemId]).changes > 0;
  }

  importAsset(input: { filename: string; mime_type: string; base64: string; project_id?: string | null }): MediaAsset {
    const format = formats[input.mime_type];
    if (!format) throw new Error('Unsupported preview format. Use PNG, JPEG, GIF, WebP, MP3, WAV, OGG, MP4 or WebM.');
    const filename = boundedText(input.filename, 'Filename', 255, true).split(/[\\/]/).pop()!;
    if (!filename || filename === '.' || filename === '..') throw new Error('Invalid filename');
    if (typeof input.base64 !== 'string' || !input.base64 || input.base64.length > Math.ceil(maxAssetBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)) throw new Error('Invalid or oversized base64 asset');
    const bytes = Buffer.from(input.base64, 'base64');
    if (!bytes.length || bytes.length > maxAssetBytes) throw new Error('Asset exceeds 8 MB');
    if (!format.valid(bytes)) throw new Error('File content does not match the selected media type');
    const usedBytes = this.db.get<{ total: number }>('SELECT COALESCE(SUM(bytes), 0) AS total FROM media_assets')?.total ?? 0;
    if (usedBytes + bytes.length > maxLibraryBytes) throw new Error('Media library exceeds its 512 MB storage limit');
    if (input.project_id && !this.getProject(input.project_id)) throw new Error('Creative project not found');
    const id = crypto.randomUUID(); const storageName = `${id}${format.extension}`;
    const filePath = path.join(this.storageDir, storageName);
    fs.writeFileSync(filePath, bytes, { flag: 'wx' });
    const timestamp = new Date().toISOString();
    try {
      this.db.run('INSERT INTO media_assets (id,filename,mime_type,kind,bytes,storage_name,project_id,created_at) VALUES (?,?,?,?,?,?,?,?)',
        [id, filename, input.mime_type, format.kind, bytes.length, storageName, input.project_id ?? null, timestamp]);
    } catch (error) { fs.unlinkSync(filePath); throw error; }
    return { id, filename, mime_type: input.mime_type, kind: format.kind, bytes: bytes.length, project_id: input.project_id ?? null, created_at: timestamp };
  }
  getAsset(id: string): MediaAsset | null {
    const asset = this.db.get<MediaAsset>('SELECT id,filename,mime_type,kind,bytes,project_id,created_at FROM media_assets WHERE id=?', [id]);
    return asset ?? null;
  }
  assets(projectId?: string): MediaAsset[] {
    return projectId
      ? this.db.all<MediaAsset>('SELECT id,filename,mime_type,kind,bytes,project_id,created_at FROM media_assets WHERE project_id=? ORDER BY created_at DESC LIMIT 200', [projectId])
      : this.db.all<MediaAsset>('SELECT id,filename,mime_type,kind,bytes,project_id,created_at FROM media_assets ORDER BY created_at DESC LIMIT 200');
  }
  assetContent(id: string): { asset: MediaAsset; bytes: Buffer } | null {
    const row = this.db.get<MediaAsset & { storage_name: string }>('SELECT * FROM media_assets WHERE id=?', [id]);
    if (!row) return null;
    const { storage_name, ...asset } = row;
    if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|mp3|wav|ogg|mp4|webm)$/.test(storage_name)) throw new Error('Stored asset path is invalid');
    return { asset, bytes: fs.readFileSync(path.join(this.storageDir, storage_name)) };
  }
  deleteAsset(id: string): boolean {
    const row = this.db.get<{ storage_name: string }>('SELECT storage_name FROM media_assets WHERE id=?', [id]);
    if (!row) return false;
    if (!/^[0-9a-f-]{36}\.(png|jpg|gif|webp|mp3|wav|ogg|mp4|webm)$/.test(row.storage_name)) throw new Error('Stored asset path is invalid');
    this.db.run('DELETE FROM media_assets WHERE id=?', [id]);
    fs.rmSync(path.join(this.storageDir, row.storage_name), { force: true });
    return true;
  }
}
