import crypto from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { Audit } from '../security/audit.js';

export class BusinessError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type BusinessKind = 'companies' | 'contacts' | 'deals' | 'tasks';
const kinds: BusinessKind[] = ['companies', 'contacts', 'deals', 'tasks'];
const short = z.string().trim().min(1).max(160);
const optionalText = z.string().trim().max(4000).default('');
const id = z.string().uuid();
const isoDate = z.iso.datetime({ offset: true });
const schemas = {
  companies: z.strictObject({ name: short, domain: z.union([z.url(), z.literal('')]).default(''), industry: z.string().trim().max(120).default(''), notes: optionalText }),
  contacts: z.strictObject({ full_name: short, email: z.union([z.email(), z.literal('')]).default(''), phone: z.string().trim().max(50).default(''), company_id: id.nullable().default(null), status: z.enum(['lead', 'customer']).default('lead'), notes: optionalText }),
  deals: z.strictObject({ title: short, company_id: id.nullable().default(null), contact_id: id.nullable().default(null), amount_minor: z.number().int().nonnegative().max(1_000_000_000_000).default(0), currency: z.string().regex(/^[A-Z]{3}$/).default('USD'), stage: z.enum(['lead', 'qualified', 'proposal', 'won', 'lost']).default('lead'), expected_close_date: z.iso.date().nullable().default(null), notes: optionalText }),
  tasks: z.strictObject({ title: short, contact_id: id.nullable().default(null), deal_id: id.nullable().default(null), due_at: isoDate.nullable().default(null), status: z.enum(['open', 'done']).default('open'), notes: optionalText }),
};
const table: Record<BusinessKind, string> = { companies: 'crm_companies', contacts: 'crm_contacts', deals: 'crm_deals', tasks: 'crm_tasks' };

export class BusinessService {
  constructor(private db: Database, private audit: Audit, private workspaceId: () => string) {
    db.exec(`CREATE TABLE IF NOT EXISTS crm_companies (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS crm_contacts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, full_name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', company_id TEXT REFERENCES crm_companies(id), status TEXT NOT NULL DEFAULT 'lead', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS crm_deals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, company_id TEXT REFERENCES crm_companies(id), contact_id TEXT REFERENCES crm_contacts(id), amount_minor INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD', stage TEXT NOT NULL DEFAULT 'lead', expected_close_date TEXT, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
    db.exec(`CREATE TABLE IF NOT EXISTS crm_tasks (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, contact_id TEXT REFERENCES crm_contacts(id), deal_id TEXT REFERENCES crm_deals(id), due_at TEXT, status TEXT NOT NULL DEFAULT 'open', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`);
    for (const name of Object.values(table)) db.exec(`CREATE INDEX IF NOT EXISTS idx_${name}_workspace ON ${name}(workspace_id, deleted_at, updated_at DESC)`);
  }

  private kind(value: string): BusinessKind {
    if (!kinds.includes(value as BusinessKind)) throw new BusinessError('Unknown business record type', 404);
    return value as BusinessKind;
  }

  get(kindValue: string, recordId: string): Record<string, any> | undefined {
    const kind = this.kind(kindValue);
    return this.db.get(`SELECT * FROM ${table[kind]} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`, [recordId, this.workspaceId()]);
  }

  list(kindValue: string, filter: { q?: string; status?: string; stage?: string; company_id?: string; limit?: number } = {}) {
    const kind = this.kind(kindValue);
    const where = ['workspace_id = ?', 'deleted_at IS NULL'];
    const params: unknown[] = [this.workspaceId()];
    if (filter.q) {
      const field = kind === 'companies' ? 'name' : kind === 'contacts' ? 'full_name' : 'title';
      where.push(`${field} LIKE ?`); params.push(`%${filter.q.slice(0, 100)}%`);
    }
    if (kind === 'contacts' || kind === 'tasks') if (filter.status) { where.push('status = ?'); params.push(filter.status); }
    if (kind === 'deals' && filter.stage) { where.push('stage = ?'); params.push(filter.stage); }
    if (['contacts', 'deals'].includes(kind) && filter.company_id) { where.push('company_id = ?'); params.push(filter.company_id); }
    const bounded = Number.isFinite(filter.limit) ? Math.max(1, Math.min(Math.trunc(filter.limit!), 500)) : 100;
    params.push(bounded);
    return this.db.all(`SELECT * FROM ${table[kind]} WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`, params);
  }

  private validateLinks(kind: BusinessKind, data: Record<string, any>) {
    const references: Array<[string, BusinessKind]> = [['company_id', 'companies'], ['contact_id', 'contacts'], ['deal_id', 'deals']];
    for (const [field, target] of references) if (field in data && data[field] && !this.get(target, data[field])) throw new BusinessError(`${field} does not refer to an active record in this workspace`);
    if (kind === 'deals' && data.company_id && data.contact_id) {
      const contact = this.get('contacts', data.contact_id);
      if (contact?.company_id && contact.company_id !== data.company_id) throw new BusinessError('Contact belongs to another company');
    }
    if (kind === 'tasks' && data.contact_id && data.deal_id) {
      const deal = this.get('deals', data.deal_id);
      if (deal?.contact_id && deal.contact_id !== data.contact_id) throw new BusinessError('Task contact differs from deal contact');
    }
  }

  private validateDependentLinks(kind: BusinessKind, recordId: string, data: Record<string, any>) {
    if (kind === 'contacts' && data.company_id) {
      const deal = this.db.get<{ id: string }>(`SELECT id FROM crm_deals WHERE contact_id = ? AND company_id IS NOT NULL AND company_id != ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1`, [recordId, data.company_id, this.workspaceId()]);
      if (deal) throw new BusinessError('Contact belongs to another company than a linked deal');
    }
    if (kind === 'deals' && data.contact_id) {
      const task = this.db.get<{ id: string }>(`SELECT id FROM crm_tasks WHERE deal_id = ? AND contact_id IS NOT NULL AND contact_id != ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1`, [recordId, data.contact_id, this.workspaceId()]);
      if (task) throw new BusinessError('Deal contact differs from a linked task contact');
    }
  }

  create(kindValue: string, raw: unknown) {
    const kind = this.kind(kindValue);
    const parsed = schemas[kind].safeParse(raw);
    if (!parsed.success) throw new BusinessError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const data = parsed.data as Record<string, any>;
    this.validateLinks(kind, data);
    const recordId = crypto.randomUUID(); const now = new Date().toISOString();
    const keys = Object.keys(data);
    this.db.run(`INSERT INTO ${table[kind]} (id, workspace_id, ${keys.join(', ')}, created_at, updated_at) VALUES (?, ?, ${keys.map(() => '?').join(', ')}, ?, ?)`, [recordId, this.workspaceId(), ...keys.map((key) => data[key]), now, now]);
    this.audit.log({ actor: 'user:api', action: `business.${kind}.create`, resource: recordId, decision: 'created' });
    return this.get(kind, recordId)!;
  }

  update(kindValue: string, recordId: string, raw: unknown) {
    const kind = this.kind(kindValue);
    const current = this.get(kind, recordId);
    if (!current) throw new BusinessError('Business record not found', 404);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BusinessError('Patch must be an object');
    const keys = Object.keys(raw);
    if (!keys.length) throw new BusinessError('No editable fields supplied');
    const editable = Object.keys(schemas[kind].shape);
    const priorFields = Object.fromEntries(editable.map((field) => [field, current[field]]));
    const parsed = schemas[kind].safeParse({ ...priorFields, ...raw });
    if (!parsed.success) throw new BusinessError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    const updated = parsed.data as Record<string, any>;
    this.validateLinks(kind, updated);
    this.validateDependentLinks(kind, recordId, updated);
    this.db.run(`UPDATE ${table[kind]} SET ${keys.map((key) => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND workspace_id = ?`, [...keys.map((key) => updated[key]), new Date().toISOString(), recordId, this.workspaceId()]);
    this.audit.log({ actor: 'user:api', action: `business.${kind}.update`, resource: recordId, decision: 'updated', details: { fields: keys } });
    return this.get(kind, recordId)!;
  }

  delete(kindValue: string, recordId: string) {
    const kind = this.kind(kindValue);
    if (!this.get(kind, recordId)) throw new BusinessError('Business record not found', 404);
    const children: Partial<Record<BusinessKind, Array<[BusinessKind, string]>>> = {
      companies: [['contacts', 'company_id'], ['deals', 'company_id']],
      contacts: [['deals', 'contact_id'], ['tasks', 'contact_id']],
      deals: [['tasks', 'deal_id']],
    };
    for (const [childKind, field] of children[kind] ?? []) {
      if (this.db.get(`SELECT id FROM ${table[childKind]} WHERE ${field} = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1`, [recordId, this.workspaceId()])) throw new BusinessError(`Cannot delete while active ${childKind} are linked`, 409);
    }
    const now = new Date().toISOString();
    this.db.run(`UPDATE ${table[kind]} SET deleted_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`, [now, now, recordId, this.workspaceId()]);
    this.audit.log({ actor: 'user:api', action: `business.${kind}.delete`, resource: recordId, decision: 'deleted' });
    return { ok: true };
  }

  summary() {
    const workspace = this.workspaceId();
    const count = (name: BusinessKind, extra = '') => this.db.get<{ value: number }>(`SELECT COUNT(*) value FROM ${table[name]} WHERE workspace_id = ? AND deleted_at IS NULL ${extra}`, [workspace])?.value ?? 0;
    const pipeline = this.db.all<{ currency: string; stage: string; amount_minor: number; deals: number }>("SELECT currency, stage, SUM(amount_minor) amount_minor, COUNT(*) deals FROM crm_deals WHERE workspace_id = ? AND deleted_at IS NULL GROUP BY currency, stage", [workspace]);
    const overdue = this.db.get<{ value: number }>("SELECT COUNT(*) value FROM crm_tasks WHERE workspace_id = ? AND deleted_at IS NULL AND status = 'open' AND due_at < ?", [workspace, new Date().toISOString()])?.value ?? 0;
    return { companies: count('companies'), contacts: count('contacts'), leads: count('contacts', "AND status = 'lead'"), customers: count('contacts', "AND status = 'customer'"), deals: count('deals'), open_tasks: count('tasks', "AND status = 'open'"), overdue_tasks: overdue, pipeline };
  }
}
