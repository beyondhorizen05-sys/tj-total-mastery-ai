import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Audit } from '../src/security/audit.js';
import { SkillService, validateSkillManifest } from '../src/skills/service.js';
import { registerSkillRoutes } from '../src/server/routes/skills.js';

const fixture = () => ({
  id: 'welcome.note',
  version: '1.0.0',
  description: 'Write a welcome note from supplied text',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', maxLength: 100 }, place: { type: 'string', maxLength: 100 } },
    required: ['name'],
    additionalProperties: false,
  },
  output_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  permissions: [],
  execution: { method: 'text_template', template: 'Welcome {{name}} to {{place}}.' },
  dependencies: [],
  network_access: false,
  file_access: false,
  os_privileges: false,
  secrets_required: [],
});

describe('local text skill lifecycle', () => {
  let dir: string;
  let db: Database;
  let skills: SkillService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-skills-'));
    db = new Database(path.join(dir, 'test.sqlite'));
    db.migrate();
    skills = new SkillService(dir, new Audit(db));
  });

  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('discovers, installs, reviews, runs, monitors, updates and disables a real local skill', () => {
    const manifest = fixture();
    fs.writeFileSync(path.join(skills.catalogPath(), 'welcome.json'), JSON.stringify(manifest));
    expect(skills.discover()).toEqual([expect.objectContaining({ filename: 'welcome.json', manifest: expect.objectContaining({ id: 'welcome.note' }) })]);
    expect(skills.installFromCatalog('welcome.json').enabled).toBe(false);
    expect(() => skills.run('welcome.note', { name: 'A', place: 'TJ' })).toThrow('disabled');
    expect(() => skills.setEnabled('welcome.note', true, false)).toThrow('Explicit permission review');
    expect(skills.setEnabled('welcome.note', true, true).reviewed_at).toBeTruthy();
    expect(skills.run('welcome.note', { name: 'Jazib', place: 'TJ' }).output).toEqual({ text: 'Welcome Jazib to TJ.' });
    expect(skills.runs('welcome.note')).toEqual([expect.objectContaining({ status: 'completed', skill_id: 'welcome.note' })]);
    expect(JSON.stringify(skills.runs())).not.toContain('Jazib');
    expect(new SkillService(dir, new Audit(db)).get('welcome.note')?.enabled).toBe(true);

    const updated = { ...manifest, version: '1.0.1', execution: { method: 'text_template', template: 'Hello {{name}}.' } };
    expect(skills.install(updated).enabled).toBe(false);
    expect(() => skills.run('welcome.note', { name: 'Jazib' })).toThrow('disabled');
    skills.setEnabled('welcome.note', true, true);
    expect(skills.run('welcome.note', { name: 'Jazib' }).output.text).toBe('Hello Jazib.');
    skills.setEnabled('welcome.note', false, false);
    expect(() => skills.run('welcome.note', { name: 'Jazib' })).toThrow('disabled');
  });

  it('rejects unsupported privilege claims and malformed manifests before install', () => {
    expect(() => validateSkillManifest({ ...fixture(), network_access: true })).toThrow('cannot request network');
    expect(() => validateSkillManifest({ ...fixture(), permissions: ['shell.execute'] })).toThrow('empty permissions');
    expect(() => validateSkillManifest({ ...fixture(), execution: { method: 'text_template', template: '{{undeclared}}' } })).toThrow('undeclared input');
    expect(() => skills.installFromCatalog('../outside.json')).toThrow('Invalid catalog filename');
    expect(skills.list()).toEqual([]);
  });

  it('does not treat inherited object keys as declared inputs or installed skills', () => {
    expect(() => validateSkillManifest({ ...fixture(), input_schema: { ...fixture().input_schema, required: ['constructor'] } })).toThrow('Required input does not exist');
    expect(() => validateSkillManifest({ ...fixture(), execution: { method: 'text_template', template: '{{constructor}}' } })).toThrow('undeclared input');
    expect(skills.get('constructor')).toBeUndefined();
    const manifest = { ...fixture(), id: 'constructor' };
    expect(skills.install(manifest).manifest.id).toBe('constructor');
    skills.setEnabled('constructor', true, true);
    expect(() => skills.run('constructor', { name: 'Jazib', constructor: 'unexpected' })).toThrow('Unknown input: constructor');
  });

  it('checks runtime inputs and records failures without storing private input', () => {
    skills.install(fixture());
    skills.setEnabled('welcome.note', true, true);
    expect(() => skills.run('welcome.note', { place: 'TJ' })).toThrow('Missing input');
    expect(() => skills.run('welcome.note', { name: 'secret-name', extra: 'x' })).toThrow('Unknown input');
    expect(skills.runs().map((run) => run.status)).toEqual(['failed', 'failed']);
    expect(fs.readFileSync(path.join(dir, 'skills', 'installed.json'), 'utf8')).not.toContain('secret-name');
  });

  it('exposes a working API and requires explicit review before execution', async () => {
    const app = Fastify();
    registerSkillRoutes(app, { skills });
    try {
      const validated = await app.inject({ method: 'POST', url: '/api/v1/skills/validate', payload: fixture() });
      expect(validated.statusCode).toBe(200);
      const installed = await app.inject({ method: 'POST', url: '/api/v1/skills', payload: fixture() });
      expect(installed.statusCode).toBe(201);
      const premature = await app.inject({ method: 'POST', url: '/api/v1/skills/welcome.note/run', payload: { input: { name: 'Jazib' } } });
      expect(premature.statusCode).toBe(403);
      const unreviewed = await app.inject({ method: 'POST', url: '/api/v1/skills/welcome.note/enable', payload: {} });
      expect(unreviewed.statusCode).toBe(400);
      const enabled = await app.inject({ method: 'POST', url: '/api/v1/skills/welcome.note/enable', payload: { reviewed: true } });
      expect(enabled.statusCode).toBe(200);
      const result = await app.inject({ method: 'POST', url: '/api/v1/skills/welcome.note/run', payload: { input: { name: 'Jazib', place: 'TJ' } } });
      expect(result.json().output.text).toBe('Welcome Jazib to TJ.');
      const runs = await app.inject({ method: 'GET', url: '/api/v1/skills/welcome.note/runs' });
      expect(runs.json().runs).toHaveLength(1);
    } finally { await app.close(); }
  });
});
