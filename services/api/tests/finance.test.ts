import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/db/database.js';
import { FinanceService } from '../src/finance/service.js';
import { registerFinanceRoutes } from '../src/server/routes/finance.js';
import { Vault } from '../src/security/vault.js';

let vaultDir: string;
beforeAll(() => { vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-finance-vault-test-')); });
afterAll(() => { for (const name of fs.readdirSync(vaultDir)) fs.unlinkSync(path.join(vaultDir, name)); fs.rmdirSync(vaultDir); });

function setup() {
  const db = new Database(':memory:'); db.migrate();
  const vault = new Vault(db, vaultDir);
  return { db, vault, finance: new FinanceService(db, vault) };
}

describe('local finance analysis', () => {
  it('keeps transaction details encrypted in the database file across restart', () => {
    const file = path.join(vaultDir, 'finance-records.sqlite');
    const firstDb = new Database(file); firstDb.migrate();
    const first = new FinanceService(firstDb, new Vault(firstDb, vaultDir));
    first.setCurrency('AED');
    first.addTransaction({ date: '2026-10-08', kind: 'expense', amount: '91.23', category: 'private category', description: 'Very private meal' });
    firstDb.close();
    const disk = fs.readFileSync(file);
    expect(disk.includes(Buffer.from('Very private meal'))).toBe(false);
    expect(disk.includes(Buffer.from('private category'))).toBe(false);

    const secondDb = new Database(file); secondDb.migrate();
    const second = new FinanceService(secondDb, new Vault(secondDb, vaultDir));
    expect(second.summary('2026-10').transactions[0]).toMatchObject({ description: 'Very private meal', amount_minor: 9123 });
    secondDb.close();
  });

  it('uses integer minor units for manual entries, budgets and monthly summaries', () => {
    const { db, finance } = setup();
    expect(finance.status()).toMatchObject({ currency: null, analysis_only: true });
    expect(() => finance.addTransaction({ date: '2026-10-08', kind: 'expense', amount: '1.00', category: 'Food' })).toThrow(/Choose a currency/);
    finance.setCurrency('AED');
    finance.addTransaction({ date: '2026-10-08', kind: 'expense', amount: '12.34', category: 'Food', description: 'Lunch' });
    finance.addTransaction({ date: '2026-10-09', kind: 'expense', amount: '2.01', category: 'food' });
    finance.addTransaction({ date: '2026-10-10', kind: 'income', amount: '100.00', category: 'Salary' });
    finance.addBudget({ month: '2026-10', category: 'FOOD', limit: '20.00' });
    const summary = finance.summary('2026-10');
    expect(summary).toMatchObject({ currency: 'AED', expense_minor: 1435, income_minor: 10000, net_cashflow_minor: 8565, transaction_count: 3 });
    expect(summary.categories.find((item) => item.category === 'food')).toMatchObject({ expense_minor: 1435, transaction_count: 2 });
    expect(summary.budgets[0]).toMatchObject({ category: 'food', limit_minor: 2000, spent_minor: 1435, remaining_minor: 565, over_budget: false });
    expect(summary).not.toHaveProperty('balance');
    const encrypted = db.get<{ ciphertext: string }>('SELECT ciphertext FROM finance_secure_transactions LIMIT 1');
    expect(encrypted?.ciphertext).not.toContain('Lunch');
    expect(db.get('SELECT name FROM sqlite_master WHERE name=?', ['finance_transactions'])).toBeUndefined();
    db.close();
  });

  it('rejects fractional cents, negative values, false dates and mixed currency', () => {
    const { db, finance } = setup();
    finance.setCurrency('USD');
    expect(() => finance.addTransaction({ date: '2026-02-30', kind: 'expense', amount: '1.00', category: 'Food' })).toThrow(/real calendar day/);
    expect(() => finance.addTransaction({ date: '2026-10-08', kind: 'expense', amount: '1.001', category: 'Food' })).toThrow(/decimal string/);
    expect(() => finance.addTransaction({ date: '2026-10-08', kind: 'expense', amount: '-1.00', category: 'Food' })).toThrow(/decimal string/);
    finance.addTransaction({ date: '2026-10-08', kind: 'expense', amount: '1.00', category: 'Food' });
    expect(() => finance.setCurrency('EUR')).toThrow(/locked/);
    db.close();
  });

  it('accepts valid four-digit dates before year 100 without changing their year', () => {
    const { db, finance } = setup();
    finance.setCurrency('USD');
    expect(finance.addTransaction({ date: '0096-02-29', kind: 'expense', amount: '1.00', category: 'Archive' }).date).toBe('0096-02-29');
    expect(finance.summary('0096-02').expense_minor).toBe(100);
    expect(() => finance.addTransaction({ date: '0099-02-29', kind: 'expense', amount: '1.00', category: 'Archive' })).toThrow(/real calendar day/);
    db.close();
  });

  it('imports a quoted CSV atomically and prevents exact duplicate imports', () => {
    const { db, finance } = setup();
    finance.setCurrency('AED');
    const csv = 'date,kind,amount,category,description\r\n2026-10-01,expense,5.25,food,"Lunch, cafe"\r\n2026-10-02,income,100.00,salary,"Monthly pay"\r\n';
    expect(finance.importCsv(csv, 'october.csv').imported).toBe(2);
    expect(finance.listTransactions()).toHaveLength(2);
    expect(finance.listTransactions().find((item) => item.category === 'food')?.description).toBe('Lunch, cafe');
    expect(() => finance.importCsv(csv, 'october.csv')).toThrow(/already imported/);
    const invalid = 'date,kind,amount,category,description\n2026-10-03,expense,1.00,food,ok\n2026-10-04,expense,1.001,food,bad';
    expect(() => finance.importCsv(invalid, 'bad.csv')).toThrow(/row 3/);
    expect(finance.listTransactions()).toHaveLength(2);
    db.close();
  });

  it('migrates unreleased plaintext records into encrypted storage and drops old tables', () => {
    const file = path.join(vaultDir, 'legacy-finance.sqlite');
    const oldDb = new Database(file); oldDb.migrate();
    oldDb.exec('CREATE TABLE finance_transactions (id TEXT PRIMARY KEY,date TEXT,kind TEXT,amount_minor INTEGER,category TEXT,description TEXT,source TEXT,created_at TEXT)');
    oldDb.run('INSERT INTO finance_transactions VALUES (?,?,?,?,?,?,?,?)', ['old-id', '2026-10-01', 'expense', 250, 'food', 'Private lunch', 'manual', '2026-10-01T00:00:00.000Z']);
    oldDb.close();
    expect(fs.readFileSync(file).includes(Buffer.from('Private lunch'))).toBe(true);

    const db = new Database(file); db.migrate();
    const finance = new FinanceService(db, new Vault(db, vaultDir));
    finance.setCurrency('AED');
    expect(finance.summary('2026-10').expense_minor).toBe(250);
    expect(db.get('SELECT name FROM sqlite_master WHERE name=?', ['finance_transactions'])).toBeUndefined();
    expect(db.get<{ ciphertext: string }>('SELECT ciphertext FROM finance_secure_transactions WHERE id=?', ['old-id'])?.ciphertext).not.toContain('Private lunch');
    db.close();
    expect(fs.readFileSync(file).includes(Buffer.from('Private lunch'))).toBe(false);
  });
});

describe('finance API', () => {
  it('exposes analysis and input routes without an execution endpoint', async () => {
    const { db, finance } = setup();
    const app = Fastify(); registerFinanceRoutes(app, { finance });
    expect((await app.inject({ method: 'GET', url: '/api/v1/finance/status' })).json()).toMatchObject({ currency: null, analysis_only: true });
    expect((await app.inject({ method: 'POST', url: '/api/v1/finance/currency', payload: { currency: 'GBP' } })).statusCode).toBe(200);
    const entry = await app.inject({ method: 'POST', url: '/api/v1/finance/transactions', payload: { date: '2026-10-08', kind: 'expense', amount: '3.45', category: 'Travel' } });
    expect(entry.statusCode).toBe(201);
    const summary = await app.inject({ method: 'GET', url: '/api/v1/finance/summary?month=2026-10' });
    expect(summary.json()).toMatchObject({ expense_minor: 345, currency: 'GBP' });
    expect((await app.inject({ method: 'POST', url: '/api/v1/finance/pay', payload: {} })).statusCode).toBe(404);
    await app.close(); db.close();
  });
});
