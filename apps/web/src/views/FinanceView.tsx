import React, { useEffect, useState } from 'react';
import { Wallet, AlertCircle, Upload } from 'lucide-react';
import { apiFetch } from '../api';

type Currency = 'AED' | 'USD' | 'EUR' | 'GBP';
type Status = { currency: Currency | null; supported_currencies: Currency[]; analysis_only: boolean; csv_limit_bytes: number; csv_limit_rows: number };
type Transaction = { id: string; date: string; kind: 'expense' | 'income'; amount_minor: number; category: string; description: string; source: string };
type CategorySummary = { category: string; expense_minor: number; income_minor: number; transaction_count: number };
type Budget = { id: string; month: string; category: string; limit_minor: number; spent_minor: number; remaining_minor: number; over_budget: boolean };
type Summary = { currency: Currency; month: string; expense_minor: number; income_minor: number; net_cashflow_minor: number; transaction_count: number; categories: CategorySummary[]; budgets: Budget[]; transactions: Transaction[] };

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const money = (minor: number, currency: Currency) => {
  const absolute = Math.abs(minor);
  return `${minor < 0 ? '−' : ''}${currency} ${Math.floor(absolute / 100).toLocaleString()}.${String(absolute % 100).padStart(2, '0')}`;
};
const field: React.CSSProperties = { padding: 10, border: '1px solid var(--border-subtle)', borderRadius: 7, background: 'var(--bg-card)', color: 'var(--text-main)', font: 'inherit', minWidth: 0 };
const button: React.CSSProperties = { padding: '10px 15px', background: 'var(--accent-cyan)', border: 0, borderRadius: 7, color: '#000', fontWeight: 700, cursor: 'pointer' };
const card: React.CSSProperties = { background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 18 };

export const FinanceView: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [currencyChoice, setCurrencyChoice] = useState<Currency>('AED');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetLimit, setBudgetLimit] = useState('');
  const [csv, setCsv] = useState<string | null>(null);
  const [csvName, setCsvName] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadStatus = async () => {
    const result = await apiFetch<Status>('/api/v1/finance/status');
    setStatus(result);
    return result;
  };
  const loadSummary = async (selectedMonth: string) => {
    const result = await apiFetch<Summary>(`/api/v1/finance/summary?month=${encodeURIComponent(selectedMonth)}`);
    setSummary(result);
  };
  useEffect(() => { loadStatus().catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => { if (status?.currency) loadSummary(month).catch((e: Error) => setError(e.message)); }, [status?.currency, month]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const chooseCurrency = (event: React.FormEvent) => { event.preventDefault(); void act(async () => {
    await apiFetch('/api/v1/finance/currency', { method: 'POST', body: JSON.stringify({ currency: currencyChoice }) });
    await loadStatus(); setNotice(`Currency set to ${currencyChoice}.`);
  }); };
  const addTransaction = (event: React.FormEvent) => { event.preventDefault(); void act(async () => {
    await apiFetch('/api/v1/finance/transactions', { method: 'POST', body: JSON.stringify({ date, kind, amount, category, description }) });
    setAmount(''); setDescription(''); await loadSummary(month); setNotice('Manual transaction saved.');
  }); };
  const addBudget = (event: React.FormEvent) => { event.preventDefault(); void act(async () => {
    await apiFetch('/api/v1/finance/budgets', { method: 'POST', body: JSON.stringify({ month, category: budgetCategory, limit: budgetLimit }) });
    setBudgetCategory(''); setBudgetLimit(''); await loadSummary(month); setNotice('Monthly category budget saved.');
  }); };
  const chooseCsv = async (file?: File) => {
    setCsv(null); setCsvName(''); setError(null);
    if (!file) return;
    if (!/\.csv$/i.test(file.name) || file.size > 512 * 1024) { setError('Choose a .csv file up to 512 KB.'); return; }
    try { setCsv(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())); setCsvName(file.name); }
    catch { setError('CSV must be a readable UTF-8 text file.'); }
  };
  const importCsv = (event: React.FormEvent) => { event.preventDefault(); if (csv === null) return; void act(async () => {
    const result = await apiFetch<{ imported: number }>('/api/v1/finance/import/csv', { method: 'POST', body: JSON.stringify({ csv, filename: csvName }) });
    setCsv(null); setCsvName(''); await loadSummary(month); setNotice(`${result.imported} transactions imported. Other months are available through the month selector.`);
  }); };

  const currency = status?.currency;
  const maxCategory = Math.max(1, ...(summary?.categories.map((item) => item.expense_minor) ?? []));
  return <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, color: 'var(--text-main)', display: 'grid', gap: 18 }}>
    <header><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Wallet size={28} color="var(--accent-cyan)" /><h1 style={{ margin: 0 }}>Personal finance</h1></div><p style={{ color: 'var(--text-muted)' }}>Local recordkeeping and analysis of transactions you enter or import. No bank connection, payment, trading, account balance, or financial advice.</p></header>
    {error && <p role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(244,63,94,.1)', color: '#fb7185', padding: 13, borderRadius: 8 }}><AlertCircle size={18} />{error}</p>}
    {notice && <p role="status" style={{ color: 'var(--accent-cyan)' }}>{notice}</p>}
    {!currency && <form onSubmit={chooseCurrency} style={{ ...card, display: 'grid', gap: 10, maxWidth: 470 }}><h2 style={{ margin: 0 }}>Choose one currency</h2><p style={{ color: 'var(--text-muted)', margin: 0 }}>All records use two decimal places. This module does not convert currencies. Choose the currency of the records you will enter.</p><select style={field} value={currencyChoice} onChange={(e) => setCurrencyChoice(e.target.value as Currency)}>{status?.supported_currencies.map((item) => <option key={item} value={item}>{item}</option>)}</select><button style={{ ...button, justifySelf: 'start' }} disabled={busy}>Set currency</button></form>}
    {currency && <>
      <section style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}><strong>Currency: {currency}</strong><label>Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ ...field, marginLeft: 7 }} /></label><small style={{ color: 'var(--text-muted)' }}>Currency stays fixed to prevent accidental mixed-currency totals.</small></section>
      {summary && <>
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {[['Entered income', summary.income_minor], ['Entered spending', summary.expense_minor], ['Net entered cashflow', summary.net_cashflow_minor]].map(([label, value]) => <div key={String(label)} style={card}><small style={{ color: 'var(--text-muted)' }}>{label}</small><strong style={{ display: 'block', marginTop: 7, fontSize: 21 }}>{money(value as number, currency)}</strong></div>)}
        </section>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>These totals only include records entered here. Net cashflow is income minus spending for {month}; it is not an account balance.</p>
        <section style={card}><h2 style={{ marginTop: 0 }}>Spending by category</h2>{summary.categories.filter((item) => item.expense_minor > 0).length === 0 && <p style={{ color: 'var(--text-muted)' }}>No expense records this month.</p>}{summary.categories.filter((item) => item.expense_minor > 0).map((item) => <div key={item.category} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 160px) 1fr auto', gap: 8, alignItems: 'center', marginBottom: 8 }}><span>{item.category}</span><div style={{ height: 13, borderRadius: 6, background: 'var(--bg-card)' }}><div style={{ width: `${item.expense_minor / maxCategory * 100}%`, height: '100%', background: 'var(--accent-cyan)', borderRadius: 6 }} /></div><strong>{money(item.expense_minor, currency)}</strong></div>)}</section>
        <section style={card}><h2 style={{ marginTop: 0 }}>Budgets for {month}</h2>{summary.budgets.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No category budgets yet.</p>}{summary.budgets.map((item) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px solid var(--border-subtle)' }}><strong>{item.category}</strong><span>Spent {money(item.spent_minor, currency)} / limit {money(item.limit_minor, currency)} · <b style={{ color: item.over_budget ? '#fb7185' : 'var(--accent-cyan)' }}>{item.over_budget ? `over by ${money(-item.remaining_minor, currency)}` : `${money(item.remaining_minor, currency)} left`}</b></span></div>)}<form onSubmit={addBudget} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}><input style={field} maxLength={60} required placeholder="Category" value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} /><input style={field} inputMode="decimal" required placeholder="Monthly limit, e.g. 300.00" value={budgetLimit} onChange={(e) => setBudgetLimit(e.target.value)} /><button style={button} disabled={busy}>Save budget</button></form></section>
      </>}
      <section style={card}><h2 style={{ marginTop: 0 }}>Add transaction manually</h2><form onSubmit={addTransaction} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><input type="date" style={field} required value={date} onChange={(e) => setDate(e.target.value)} /><select style={field} value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}><option value="expense">Expense</option><option value="income">Income</option></select><input style={field} inputMode="decimal" required placeholder="Amount, e.g. 12.34" value={amount} onChange={(e) => setAmount(e.target.value)} /><input style={field} maxLength={60} required placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} /><input style={field} maxLength={200} placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} /><button style={button} disabled={busy}>Save entry</button></form></section>
      <section style={card}><h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}><Upload size={20} />Import transactions</h2><p style={{ color: 'var(--text-muted)' }}>UTF-8 CSV, 512 KB / 5,000 rows max. Header: <code>date,kind,amount,category,description</code>. Dates use YYYY-MM-DD; kind is expense or income; amount has up to two decimal places. Reimporting the exact same file is blocked.</p><form onSubmit={importCsv} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><input type="file" accept=".csv,text/csv" onChange={(e) => chooseCsv(e.target.files?.[0])} /><span>{csvName}</span><button style={button} disabled={busy || csv === null}>Import CSV</button></form></section>
      {summary && <section style={card}><h2 style={{ marginTop: 0 }}>Transactions for {month} <small style={{ color: 'var(--text-muted)' }}>({summary.transaction_count} total; showing up to 100)</small></h2>{summary.transactions.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No entered transactions this month.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Date', 'Kind', 'Category', 'Description', 'Amount', 'Source'].map((heading) => <th key={heading} style={{ textAlign: 'left', padding: 9, borderBottom: '1px solid var(--border-subtle)' }}>{heading}</th>)}</tr></thead><tbody>{summary.transactions.map((item) => <tr key={item.id}>{[item.date, item.kind, item.category, item.description || '—', money(item.amount_minor, currency), item.source].map((value, index) => <td key={index} style={{ padding: 9, borderBottom: '1px solid var(--border-subtle)' }}>{value}</td>)}</tr>)}</tbody></table></div>}</section>}
    </>}
  </div>;
};
