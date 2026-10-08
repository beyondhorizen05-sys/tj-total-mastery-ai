import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Audit } from '../src/security/audit.js';
import { BusinessService } from '../src/business/service.js';
import { registerBusinessRoutes } from '../src/server/routes/business.js';

describe('local Business OS CRM', () => {
  let dir: string;
  let db: Database;
  let audit: Audit;
  let business: BusinessService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-business-'));
    db = new Database(path.join(dir, 'business.sqlite'));
    db.migrate();
    audit = new Audit(db);
    business = new BusinessService(db, audit, () => 'default');
  });

  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('creates, links, filters, updates and safely removes CRM records', () => {
    const company = business.create('companies', { name: 'Acme', domain: 'https://acme.example', industry: 'Software', notes: 'Prospect' });
    const contact = business.create('contacts', { full_name: 'Ada', email: 'ada@acme.example', company_id: company.id, status: 'lead' });
    const deal = business.create('deals', { title: 'Annual plan', company_id: company.id, contact_id: contact.id, amount_minor: 12500, currency: 'USD', stage: 'qualified' });
    const task = business.create('tasks', { title: 'Call Ada', contact_id: contact.id, deal_id: deal.id, due_at: '2026-10-08T10:00:00.000Z' });
    expect(contact.company_id).toBe(company.id);
    expect(db.get('SELECT id FROM crm_contacts WHERE company_id = ? AND workspace_id = ? AND deleted_at IS NULL', [company.id, 'default'])).toBeDefined();
    expect(business.summary()).toMatchObject({ companies: 1, contacts: 1, leads: 1, deals: 1, open_tasks: 1, pipeline: [expect.objectContaining({ currency: 'USD', stage: 'qualified', amount_minor: 12500 })] });
    expect(business.list('contacts', { q: 'Ada', status: 'lead' })).toHaveLength(1);
    expect(business.list('deals', { stage: 'won' })).toHaveLength(0);
    expect(business.update('deals', deal.id, { stage: 'won' }).stage).toBe('won');
    expect(business.update('contacts', contact.id, { status: 'customer' }).status).toBe('customer');
    expect(business.get('deals', deal.id)?.company_id).toBe(company.id);
    expect(business.get('contacts', contact.id)?.company_id).toBe(company.id);
    expect(() => business.delete('companies', company.id)).toThrow('active contacts');
    expect(() => business.delete('deals', deal.id)).toThrow('active tasks');
    business.delete('tasks', task.id);
    business.delete('deals', deal.id);
    business.delete('contacts', contact.id);
    business.delete('companies', company.id);
    expect(business.summary()).toMatchObject({ companies: 0, contacts: 0, deals: 0, open_tasks: 0 });
    expect(business.get('companies', company.id)).toBeUndefined();
    expect(new BusinessService(db, audit, () => 'default').list('companies')).toEqual([]);
  });

  it('rejects invalid data and cross-workspace links; keeps notes out of audit', () => {
    expect(() => business.create('contacts', { full_name: 'Bad', email: 'not an email' })).toThrow();
    expect(() => business.create('deals', { title: 'Bad', amount_minor: -1 })).toThrow();
    const other = new BusinessService(db, audit, () => 'other');
    const company = other.create('companies', { name: 'Private', notes: 'secret internal account' });
    expect(() => business.create('contacts', { full_name: 'Wrong', company_id: company.id })).toThrow('this workspace');
    expect(business.list('companies')).toEqual([]);
    expect(JSON.stringify(audit.list())).not.toContain('secret internal account');
    expect(() => business.update('companies', company.id, { name: 'Hijack' })).toThrow('not found');
  });

  it('keeps linked deal and follow-up relationships valid when parents are edited', () => {
    const first = business.create('companies', { name: 'First' });
    const second = business.create('companies', { name: 'Second' });
    const contact = business.create('contacts', { full_name: 'Ada', company_id: first.id });
    const otherContact = business.create('contacts', { full_name: 'Bea', company_id: first.id });
    const deal = business.create('deals', { title: 'Plan', company_id: first.id, contact_id: contact.id });
    business.create('tasks', { title: 'Call', deal_id: deal.id, contact_id: contact.id });

    expect(() => business.update('contacts', contact.id, { company_id: second.id })).toThrow('linked deal');
    expect(() => business.update('deals', deal.id, { contact_id: otherContact.id })).toThrow('linked task');
    expect(business.get('contacts', contact.id)?.company_id).toBe(first.id);
    expect(business.get('deals', deal.id)?.contact_id).toBe(contact.id);
  });

  it('serves validated CRUD and live summary through local API', async () => {
    const app = Fastify();
    registerBusinessRoutes(app, { business });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/business/companies', payload: { name: 'Northstar' } });
      expect(created.statusCode).toBe(201);
      const companyId = created.json().item.id;
      const listed = await app.inject({ method: 'GET', url: '/api/v1/business/companies?q=North' });
      expect(listed.json().items).toHaveLength(1);
      const changed = await app.inject({ method: 'PATCH', url: `/api/v1/business/companies/${companyId}`, payload: { industry: 'Research' } });
      expect(changed.json().item.industry).toBe('Research');
      expect((await app.inject({ method: 'GET', url: '/api/v1/business/summary' })).json().companies).toBe(1);
      expect((await app.inject({ method: 'DELETE', url: `/api/v1/business/companies/${companyId}` })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: `/api/v1/business/companies/${companyId}` })).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
