import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Vault } from '../src/security/vault.js';
import { WellnessService } from '../src/wellness/service.js';
import { registerWellnessRoutes } from '../src/server/routes/wellness.js';

describe('private local wellness records', () => {
  let db: Database;
  let vaultDir: string;
  let service: WellnessService;
  beforeEach(() => {
    db = new Database(':memory:'); db.migrate();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-wellness-test-'));
    service = new WellnessService(db, new Vault(db, vaultDir));
  });
  afterEach(() => { db.close(); fs.rmSync(vaultDir, { recursive: true, force: true }); });

  it('validates bounded metrics and stores values/notes encrypted in the vault', () => {
    const entry = service.add({ date: '2026-10-08', kind: 'sleep', value: 7.5, notes: 'private bedtime note' });
    expect(entry).toMatchObject({ date: '2026-10-08', kind: 'sleep', value: 7.5, unit: 'hours', source: 'manual', source_label: 'User entered' });
    expect(service.list()[0].notes).toBe('private bedtime note');
    const row = db.get<any>('SELECT * FROM wellness_entries WHERE id=?', [entry.id]);
    expect(JSON.stringify(row)).not.toContain('7.5');
    expect(JSON.stringify(row)).not.toContain('private bedtime note');
    expect(() => service.add({ date: '2026-02-30', kind: 'sleep', value: 7 })).toThrow(/Invalid calendar date/);
    expect(() => service.add({ date: '2026-10-08', kind: 'heart_rate', value: 0 })).toThrow(/between 20 and 250/);
    expect(() => service.add({ date: '2026-10-08', kind: 'activity', value: 1.5 })).toThrow(/whole number/);
    expect(() => service.add({ date: '2026-10-08', kind: '__proto__' as any, value: 2 })).toThrow(/Metric must be/);
    expect(() => service.add({ date: '2026-10-08', kind: 'sleep', value: null as any })).toThrow(/value must be/);
  });

  it('imports bounded CSV atomically with explicit provenance and quoted notes', () => {
    const csv = 'date,kind,value,notes\n2026-10-07,sleep,6.5,"Night, interrupted"\n2026-10-08,activity,4500,"Morning walk"';
    const imported = service.importCsv(csv, 'My manual CSV');
    expect(imported.imported).toBe(2);
    expect(imported.entries[0]).toMatchObject({ source: 'csv_import', source_label: 'My manual CSV', notes: 'Night, interrupted' });
    expect(service.list()).toHaveLength(2);
    expect(() => service.importCsv('date,kind,value,notes\n2026-10-08,sleep,7,ok\n2026-10-09,sleep,99,bad', 'Failed batch')).toThrow(/CSV row 3/);
    expect(service.list()).toHaveLength(2);
    expect(() => service.importCsv('date,kind,value,notes\n2026-10-08,sleep,,missing', 'My CSV')).toThrow(/value is required/);
  });

  it('rejects malformed quoted CSV without importing any rows', async () => {
    const app = Fastify(); registerWellnessRoutes(app, { wellness: service });
    const response = await app.inject({ method: 'POST', url: '/api/v1/wellness/import', payload: {
      csv: 'date,kind,value,notes\n2026-10-07,sleep,7,valid\n2026-10-08,sleep,8,"quoted"unexpected',
      source_label: 'Malformed CSV',
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/invalid quoted field/);
    expect(service.list()).toHaveLength(0);
    expect(() => service.importCsv('date,kind,value,notes\n2026-10-08,sleep,7,bad"quote', 'Malformed CSV')).toThrow(/invalid quoted field/);
    await app.close();
  });

  it('calculates neutral date trends and clinician questions without diagnosis claims', () => {
    service.add({ date: '2026-10-07', kind: 'heart_rate', value: 70 });
    service.add({ date: '2026-10-07', kind: 'heart_rate', value: 80 });
    service.add({ date: '2026-10-08', kind: 'heart_rate', value: 72 });
    const trend = service.trend('heart_rate', '2026-10-07', '2026-10-08');
    expect(trend).toMatchObject({ unit: 'bpm', count: 3, average: 73.5, change: -3 });
    expect(trend.daily).toEqual([{ date: '2026-10-07', value: 75, count: 2 }, { date: '2026-10-08', value: 72, count: 1 }]);
    const questions = service.clinicianQuestions('heart_rate', '2026-10-07', '2026-10-08');
    expect(questions.questions).toHaveLength(4);
    expect(questions.questions.join(' ')).toContain('clinical assessment');
    expect(() => service.trend('sleep', '2025-01-01', '2026-10-08')).toThrow(/0–365 days/);
  });

  it('serves no-store records and deletes both metadata and vault secret', async () => {
    const app = Fastify(); registerWellnessRoutes(app, { wellness: service });
    const response = await app.inject({ method: 'POST', url: '/api/v1/wellness/entries', payload: { date: '2026-10-08', kind: 'nutrition', value: 2000, notes: 'user estimate' } });
    expect(response.statusCode).toBe(201);
    const id = response.json().id;
    expect(response.headers['cache-control']).toBe('no-store');
    const row = db.get<{ secret_ref: string }>('SELECT secret_ref FROM wellness_entries WHERE id=?', [id])!;
    const listed = await app.inject({ method: 'GET', url: '/api/v1/wellness/entries' });
    expect(listed.json().entries[0].value).toBe(2000);
    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/wellness/entries/${id}` });
    expect(removed.statusCode).toBe(200);
    expect(db.get('SELECT * FROM wellness_entries WHERE id=?', [id])).toBeUndefined();
    expect(db.get('SELECT * FROM secrets WHERE ref=?', [row.secret_ref])).toBeUndefined();
    await app.close();
  });
});
