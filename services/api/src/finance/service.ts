import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import type { Vault } from '../security/vault.js';
import { FinanceSecureStore, type EncryptedRow } from './secure-store.js';

export class FinanceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export type Currency = 'AED' | 'USD' | 'EUR' | 'GBP';
export type Transaction = { id: string; date: string; kind: 'expense' | 'income'; amount_minor: number; category: string; description: string; source: 'manual' | 'csv'; created_at: string };
export type Budget = { id: string; month: string; category: string; limit_minor: number; created_at: string; updated_at: string };
export type CategorySummary = { category: string; expense_minor: number; income_minor: number; transaction_count: number };
export type BudgetSummary = Budget & { spent_minor: number; remaining_minor: number; over_budget: boolean };
export type FinanceSummary = { currency: Currency; month: string; expense_minor: number; income_minor: number; net_cashflow_minor: number; transaction_count: number; categories: CategorySummary[]; budgets: BudgetSummary[]; transactions: Transaction[] };

const SUPPORTED_CURRENCIES: Currency[] = ['AED', 'USD', 'EUR', 'GBP'];
const now = () => new Date().toISOString();
const uuid = () => randomUUID();
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const AMOUNT = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const MAX_CSV_BYTES = 512 * 1024;
const MAX_CSV_ROWS = 5000;

function text(value: unknown, label: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.trim().length > max) throw new FinanceError(`${label} must be text of ${optional ? 'up to' : '1 to'} ${max} characters.`);
  return value.trim();
}
function category(value: unknown): string { return text(value, 'Category', 60).toLowerCase(); }
function minor(value: unknown, label = 'Amount'): number {
  if (typeof value !== 'string' || !AMOUNT.test(value)) throw new FinanceError(`${label} must be a positive decimal string with at most two digits after the decimal point.`);
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new FinanceError(`${label} must be greater than zero and within the supported range.`);
  return cents;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new FinanceError('Date must be YYYY-MM-DD.');
  const [year, month, day] = value.split('-').map(Number);
  // Date.UTC interprets years 00-99 as 1900-1999, even with a four-digit input.
  const actual = new Date(0);
  actual.setUTCFullYear(year, month - 1, day);
  if (actual.getUTCFullYear() !== year || actual.getUTCMonth() + 1 !== month || actual.getUTCDate() !== day) throw new FinanceError('Date is not a real calendar day.');
  return value;
}
function month(value: unknown): string {
  if (typeof value !== 'string' || !MONTH.test(value)) throw new FinanceError('Month must be YYYY-MM.');
  return value;
}

function parseCsv(csv: string): string[][] {
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) throw new FinanceError('CSV exceeds 512 KB.', 413);
  if (csv.includes('\0')) throw new FinanceError('CSV contains a null byte.');
  const source = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closedQuote = false, started = false;
  const fieldEnd = () => { row.push(field); field = ''; closedQuote = false; started = false; if (row.length > 5) throw new FinanceError('CSV must have exactly five columns.'); };
  const rowEnd = () => { fieldEnd(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; if (rows.length > MAX_CSV_ROWS + 1) throw new FinanceError('CSV exceeds 5,000 transactions.', 413); };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; closedQuote = true; }
      else field += ch;
    } else if (closedQuote) {
      if (ch === ',') fieldEnd();
      else if (ch === '\n' || ch === '\r') { rowEnd(); if (ch === '\r' && source[i + 1] === '\n') i++; }
      else throw new FinanceError(`CSV has text after a closing quote near row ${rows.length + 1}.`);
    } else if (ch === '"') {
      if (started) throw new FinanceError(`CSV has an unexpected quote near row ${rows.length + 1}.`);
      quoted = true; started = true;
    } else if (ch === ',') fieldEnd();
    else if (ch === '\n' || ch === '\r') { rowEnd(); if (ch === '\r' && source[i + 1] === '\n') i++; }
    else { field += ch; started = true; }
    if (field.length > 2000) throw new FinanceError('CSV field exceeds 2,000 characters.', 413);
  }
  if (quoted) throw new FinanceError('CSV has an unclosed quoted field.');
  if (started || closedQuote || row.length) rowEnd();
  if (!rows.length) throw new FinanceError('CSV is empty.');
  return rows;
}

/** Manual, local financial recordkeeping. No bank balance, market data, payments, or advice. */
export class FinanceService {
  private secure: FinanceSecureStore;
  constructor(private db: Database, vault: Vault) {
    this.secure = new FinanceSecureStore(db, vault);
    // Legacy development tables could have held plaintext. Overwrite freed cells
    // during migration, then rebuild/checkpoint the file before serving finance data.
    db.exec('PRAGMA secure_delete = ON');
    db.exec('CREATE TABLE IF NOT EXISTS finance_cleanup (id INTEGER PRIMARY KEY CHECK(id=1), pending INTEGER NOT NULL)');
    db.exec(`CREATE TABLE IF NOT EXISTS finance_settings (id INTEGER PRIMARY KEY CHECK(id=1), currency TEXT NOT NULL)`);
    db.exec('CREATE TABLE IF NOT EXISTS finance_secure_transactions (id TEXT PRIMARY KEY, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, tag TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS finance_secure_budgets (id TEXT PRIMARY KEY, iv TEXT NOT NULL, ciphertext TEXT NOT NULL, tag TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS finance_secure_imports (id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE)');
    this.migratePlaintextTables();
    this.finishLegacyCleanup();
  }

  /** Upgrade any unreleased/plaintext development tables without losing user records. */
  private migratePlaintextTables() {
    const exists = (name: string) => !!this.db.get('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?', [name]);
    if (!['finance_transactions', 'finance_budgets', 'finance_imports'].some(exists)) return;
    this.db.transaction(() => {
      if (exists('finance_transactions')) {
        for (const row of this.db.all<any>('SELECT * FROM finance_transactions')) {
          const record: Transaction = { id: row.id, date: row.date, kind: row.kind, amount_minor: row.amount_minor, category: row.category, description: row.description, source: row.source, created_at: row.created_at };
          this.storeTransaction(record);
        }
        this.db.exec('DROP TABLE finance_transactions');
      }
      if (exists('finance_budgets')) {
        for (const row of this.db.all<Budget>('SELECT * FROM finance_budgets')) this.storeBudget(row);
        this.db.exec('DROP TABLE finance_budgets');
      }
      if (exists('finance_imports')) {
        for (const row of this.db.all<{ id: string; sha256: string }>('SELECT id,sha256 FROM finance_imports')) this.db.run('INSERT OR IGNORE INTO finance_secure_imports (id,sha256) VALUES (?,?)', [row.id, row.sha256]);
        this.db.exec('DROP TABLE finance_imports');
      }
      this.db.run('INSERT INTO finance_cleanup (id,pending) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET pending=1');
    });
  }

  private finishLegacyCleanup() {
    if (this.db.get<{ pending: number }>('SELECT pending FROM finance_cleanup WHERE id=1')?.pending !== 1) return;
    // VACUUM rebuilds freed pages; truncating WAL removes pre-migration frames.
    // Keep the pending marker so startup retries if another connection blocks this.
    this.db.exec('VACUUM');
    const checkpoint = this.db.get<{ busy: number }>('PRAGMA wal_checkpoint(TRUNCATE)');
    if (checkpoint?.busy) throw new Error('Finance migration could not truncate the SQLite WAL. Close other database connections and restart TJ.');
    this.db.run('UPDATE finance_cleanup SET pending=0 WHERE id=1');
  }

  private storeTransaction(record: Transaction) {
    const sealed = this.secure.seal(record.id, 'transaction', record);
    this.db.run('INSERT INTO finance_secure_transactions (id,iv,ciphertext,tag) VALUES (?,?,?,?)', [sealed.id, sealed.iv, sealed.ciphertext, sealed.tag]);
  }
  private storeBudget(record: Budget) {
    const sealed = this.secure.seal(record.id, 'budget', record);
    this.db.run('INSERT OR REPLACE INTO finance_secure_budgets (id,iv,ciphertext,tag) VALUES (?,?,?,?)', [sealed.id, sealed.iv, sealed.ciphertext, sealed.tag]);
  }
  private transactions(): Transaction[] {
    return this.db.all<EncryptedRow>('SELECT * FROM finance_secure_transactions').map((row) => this.secure.open<Transaction>(row, 'transaction'));
  }
  private budgets(): Budget[] {
    return this.db.all<EncryptedRow>('SELECT * FROM finance_secure_budgets').map((row) => this.secure.open<Budget>(row, 'budget'));
  }

  currency(): Currency | null { return this.db.get<{ currency: Currency }>('SELECT currency FROM finance_settings WHERE id=1')?.currency ?? null; }
  status() { return { currency: this.currency(), supported_currencies: SUPPORTED_CURRENCIES, analysis_only: true, csv_limit_bytes: MAX_CSV_BYTES, csv_limit_rows: MAX_CSV_ROWS }; }
  setCurrency(value: unknown): Currency {
    if (typeof value !== 'string' || !SUPPORTED_CURRENCIES.includes(value as Currency)) throw new FinanceError('Choose AED, USD, EUR, or GBP.');
    const existing = this.currency();
    if (existing && existing !== value) {
      if (this.transactions().length || this.budgets().length) throw new FinanceError('Currency is locked after records are added. Conversion is not available.', 409);
      this.db.run('UPDATE finance_settings SET currency=? WHERE id=1', [value]);
      return value as Currency;
    }
    this.db.run('INSERT OR IGNORE INTO finance_settings (id,currency) VALUES (1,?)', [value]);
    return value as Currency;
  }
  private requireCurrency(): Currency {
    const selected = this.currency();
    if (!selected) throw new FinanceError('Choose a currency before adding financial records.', 409);
    return selected;
  }

  private transactionInput(input: { date: unknown; kind: unknown; amount: unknown; category: unknown; description?: unknown }): Pick<Transaction, 'date' | 'kind' | 'amount_minor' | 'category' | 'description'> {
    const when = date(input.date);
    if (input.kind !== 'expense' && input.kind !== 'income') throw new FinanceError('Transaction kind must be expense or income.');
    return { date: when, kind: input.kind, amount_minor: minor(input.amount), category: category(input.category), description: text(input.description, 'Description', 200, true) };
  }
  addTransaction(input: { date: unknown; kind: unknown; amount: unknown; category: unknown; description?: unknown }): Transaction {
    this.requireCurrency();
    const value = this.transactionInput(input);
    const record: Transaction = { id: uuid(), ...value, source: 'manual', created_at: now() };
    if (this.transactions().length >= 20_000) throw new FinanceError('Transaction limit of 20,000 reached.', 409);
    this.storeTransaction(record);
    return record;
  }
  listTransactions(limit = 100): Transaction[] {
    this.requireCurrency();
    const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 100;
    return this.transactions().sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, bounded);
  }
  addBudget(input: { month: unknown; category: unknown; limit: unknown }): Budget {
    this.requireCurrency();
    const m = month(input.month), c = category(input.category), amount = minor(input.limit, 'Budget limit');
    const existing = this.budgets().find((item) => item.month === m && item.category === c);
    if (!existing && this.budgets().length >= 2000) throw new FinanceError('Budget limit of 2,000 reached.', 409);
    const time = now(), key = existing?.id ?? uuid();
    const record = { id: key, month: m, category: c, limit_minor: amount, created_at: existing?.created_at ?? time, updated_at: time };
    this.storeBudget(record);
    return record;
  }

  importCsv(csv: unknown, filename: unknown): { imported: number; batch_id: string } {
    this.requireCurrency();
    if (typeof csv !== 'string') throw new FinanceError('CSV text is required.');
    if (typeof filename !== 'string' || !/^[^\\/\r\n\0]{1,120}\.csv$/i.test(filename)) throw new FinanceError('Filename must be a .csv name without a path.');
    const rows = parseCsv(csv);
    const header = rows.shift()!.map((item) => item.trim().toLowerCase());
    if (header.join(',') !== 'date,kind,amount,category,description') throw new FinanceError('CSV header must be date,kind,amount,category,description in that order.');
    if (!rows.length) throw new FinanceError('CSV has no transactions.');
    const records = rows.map((row, index) => {
      if (row.length !== 5) throw new FinanceError(`CSV row ${index + 2} must contain five fields.`);
      try { return this.transactionInput({ date: row[0].trim(), kind: row[1].trim().toLowerCase(), amount: row[2].trim(), category: row[3], description: row[4] }); }
      catch (error) { if (error instanceof FinanceError) throw new FinanceError(`CSV row ${index + 2}: ${error.message}`); throw error; }
    });
    const hash = createHash('sha256').update(csv, 'utf8').digest('hex');
    if (this.db.get('SELECT id FROM finance_secure_imports WHERE sha256=?', [hash])) throw new FinanceError('This exact CSV file was already imported.', 409);
    if (this.transactions().length + records.length > 20_000) throw new FinanceError('Transaction limit of 20,000 would be exceeded.', 409);
    const batch = uuid(), time = now();
    this.db.transaction(() => {
      this.db.run('INSERT INTO finance_secure_imports (id,sha256) VALUES (?,?)', [batch, hash]);
      for (const item of records) this.storeTransaction({ id: uuid(), ...item, source: 'csv', created_at: time });
    });
    return { imported: records.length, batch_id: batch };
  }

  summary(value: unknown): FinanceSummary {
    const currency = this.requireCurrency(), m = month(value);
    const transactions = this.transactions().filter((item) => item.date.startsWith(`${m}-`))
      .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const categories = new Map<string, CategorySummary>();
    let expense = 0, income = 0;
    for (const item of transactions) {
      const current = categories.get(item.category) ?? { category: item.category, expense_minor: 0, income_minor: 0, transaction_count: 0 };
      current.transaction_count++;
      if (item.kind === 'expense') { expense += item.amount_minor; current.expense_minor += item.amount_minor; }
      else { income += item.amount_minor; current.income_minor += item.amount_minor; }
      categories.set(item.category, current);
    }
    if (![expense, income].every(Number.isSafeInteger)) throw new FinanceError('Monthly total exceeds the supported range. Review imported data.', 422);
    const budgets = this.budgets().filter((budget) => budget.month === m).sort((a, b) => a.category.localeCompare(b.category)).map((budget) => {
      const spent = categories.get(budget.category)?.expense_minor ?? 0;
      return { ...budget, spent_minor: spent, remaining_minor: budget.limit_minor - spent, over_budget: spent > budget.limit_minor };
    });
    return { currency, month: m, expense_minor: expense, income_minor: income, net_cashflow_minor: income - expense, transaction_count: transactions.length,
      categories: [...categories.values()].sort((a, b) => b.expense_minor - a.expense_minor || a.category.localeCompare(b.category)), budgets, transactions: transactions.slice(0, 100) };
  }
}
