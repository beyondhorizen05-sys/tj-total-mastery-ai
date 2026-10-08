import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Kind = 'companies' | 'contacts' | 'deals' | 'tasks';
type Item = Record<string, any> & { id: string };
type Summary = { companies: number; contacts: number; leads: number; customers: number; deals: number; open_tasks: number; overdue_tasks: number; pipeline: Array<{ currency: string; stage: string; amount_minor: number; deals: number }> };
const kinds: Kind[] = ['companies', 'contacts', 'deals', 'tasks'];
const fields: Record<Kind, Array<[string, string]>> = {
  companies: [['name', 'Company name'], ['domain', 'Website URL'], ['industry', 'Industry'], ['notes', 'Notes']],
  contacts: [['full_name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'], ['company_id', 'Company'], ['status', 'Status'], ['notes', 'Notes']],
  deals: [['title', 'Deal title'], ['company_id', 'Company'], ['contact_id', 'Contact'], ['amount_minor', 'Amount in minor units'], ['currency', 'Currency'], ['stage', 'Stage'], ['expected_close_date', 'Expected close date'], ['notes', 'Notes']],
  tasks: [['title', 'Follow-up title'], ['contact_id', 'Contact'], ['deal_id', 'Deal'], ['due_at', 'Due date and time'], ['status', 'Status'], ['notes', 'Notes']],
};
const required = (kind: Kind) => kind === 'companies' ? 'name' : kind === 'contacts' ? 'full_name' : 'title';
const singular = (kind: Kind) => kind === 'companies' ? 'company' : kind === 'tasks' ? 'follow-up' : kind.slice(0, -1);
const panel: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16 };
const input: React.CSSProperties = { width: '100%', padding: '9px 10px', borderRadius: 6, color: 'var(--text-main)', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)' };
const button: React.CSSProperties = { padding: '8px 12px', color: 'var(--text-main)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer' };

export const BusinessView: React.FC = () => {
  const [kind, setKind] = useState<Kind>('companies');
  const [items, setItems] = useState<Item[]>([]);
  const [companies, setCompanies] = useState<Item[]>([]);
  const [contacts, setContacts] = useState<Item[]>([]);
  const [deals, setDeals] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const params = new URLSearchParams({ limit: '500' });
    if (search.trim()) params.set('q', search.trim());
    if (statusFilter) params.set(kind === 'deals' ? 'stage' : 'status', statusFilter);
    const [active, companyList, contactList, dealList, metrics] = await Promise.all([
      apiFetch<{ items: Item[] }>(`/api/v1/business/${kind}?${params}`),
      apiFetch<{ items: Item[] }>('/api/v1/business/companies?limit=500'),
      apiFetch<{ items: Item[] }>('/api/v1/business/contacts?limit=500'),
      apiFetch<{ items: Item[] }>('/api/v1/business/deals?limit=500'),
      apiFetch<Summary>('/api/v1/business/summary'),
    ]);
    setItems(active.items); setCompanies(companyList.items); setContacts(contactList.items); setDeals(dealList.items); setSummary(metrics);
  };

  useEffect(() => {
    const timer = setTimeout(() => { load().catch((reason) => setError((reason as Error).message)); }, 150);
    return () => clearTimeout(timer);
  }, [kind, search, statusFilter]);

  const switchKind = (next: Kind) => { setKind(next); setStatusFilter(''); setSearch(''); setForm({}); setEditingId(null); setError(''); setMessage(''); };
  const setValue = (field: string, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const edit = (item: Item) => { setEditingId(item.id); setForm(Object.fromEntries(fields[kind].map(([field]) => {
    if (item[field] == null) return [field, ''];
    if (field === 'due_at') { const date = new Date(item[field]); return [field, new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)]; }
    return [field, String(item[field])];
  }))); setMessage(''); };
  const cancel = () => { setEditingId(null); setForm({}); };

  const payload = () => {
    const result: Record<string, unknown> = {};
    for (const [field] of fields[kind]) {
      const value = form[field] ?? '';
      if (field === 'amount_minor') result[field] = Number(value || '0');
      else if (field === 'company_id' || field === 'contact_id' || field === 'deal_id' || field === 'expected_close_date') result[field] = value || null;
      else if (field === 'due_at') result[field] = value ? new Date(value).toISOString() : null;
      else if (field === 'currency') result[field] = value.trim().toUpperCase() || 'USD';
      else if (field === 'stage') result[field] = value || 'lead';
      else if (field === 'status') result[field] = value || (kind === 'contacts' ? 'lead' : 'open');
      else result[field] = value;
    }
    return result;
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await apiFetch(`/api/v1/business/${kind}${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload()) });
      setMessage(`${singular(kind)} ${editingId ? 'updated' : 'created'}.`); cancel(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const remove = async (item: Item) => {
    setBusy(true); setError(''); setMessage('');
    try {
      await apiFetch(`/api/v1/business/${kind}/${item.id}`, { method: 'DELETE' });
      setMessage('Record removed from active CRM lists.'); if (editingId === item.id) cancel(); await load();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const options = (field: string): Array<[string, string]> => {
    if (field === 'company_id') return companies.map((item) => [item.id, item.name]);
    if (field === 'contact_id') return contacts.map((item) => [item.id, item.full_name]);
    if (field === 'deal_id') return deals.map((item) => [item.id, item.title]);
    if (field === 'stage') return ['lead', 'qualified', 'proposal', 'won', 'lost'].map((item) => [item, item]);
    if (field === 'status') return (kind === 'contacts' ? ['lead', 'customer'] : ['open', 'done']).map((item) => [item, item]);
    return [];
  };

  const display = (item: Item) => kind === 'companies' ? item.name : kind === 'contacts' ? item.full_name : item.title;
  const secondary = (item: Item) => kind === 'companies' ? [item.industry, item.domain].filter(Boolean).join(' · ')
    : kind === 'contacts' ? [item.email, item.phone, item.status].filter(Boolean).join(' · ')
    : kind === 'deals' ? `${item.stage} · ${item.currency} ${item.amount_minor} minor units`
    : `${item.status}${item.due_at ? ` · due ${new Date(item.due_at).toLocaleString()}` : ''}`;

  return <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'grid', gap: 16, alignContent: 'start' }}>
    <header><h2 style={{ margin: 0 }}>Business Command Center</h2><p style={{ color: 'var(--text-muted)' }}>Local CRM records only. Pipeline values are recorded deal amounts, not verified revenue or payments.</p></header>
    {error && <p role="alert" style={{ color: '#fb7185' }}>{error}</p>}
    {message && <p role="status" style={{ color: 'var(--accent-cyan)' }}>{message}</p>}
    {summary && <section aria-label="CRM summary" style={{ ...panel, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
      {([['Companies', summary.companies], ['Contacts', summary.contacts], ['Leads', summary.leads], ['Customers', summary.customers], ['Deals', summary.deals], ['Open follow-ups', summary.open_tasks], ['Overdue', summary.overdue_tasks]] as const).map(([label, value]) =>
        <div key={label}><div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</div><strong style={{ fontSize: 24 }}>{value}</strong></div>)}
    </section>}
    {summary && summary.pipeline.length > 0 && <section style={panel}><strong>Recorded deal pipeline</strong><div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
      {summary.pipeline.map((row) => <span key={`${row.currency}:${row.stage}`}>{row.stage}: {row.currency} {row.amount_minor} minor units ({row.deals})</span>)}
    </div></section>}
    <nav aria-label="CRM records" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{kinds.map((item) => <button key={item} style={{ ...button, color: kind === item ? 'var(--accent-cyan)' : 'var(--text-main)' }} onClick={() => switchKind(item)}>{item === 'tasks' ? 'Follow-ups' : item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 390px)', gap: 16, alignItems: 'start' }}>
      <section style={panel} aria-label={`${kind} list`}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input aria-label="Search CRM records" placeholder={`Search ${kind}`} value={search} onChange={(event) => setSearch(event.target.value)} style={input} />
          {(kind === 'contacts' || kind === 'deals' || kind === 'tasks') && <select aria-label="Status filter" style={input} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All</option>{(kind === 'deals' ? ['lead', 'qualified', 'proposal', 'won', 'lost'] : kind === 'contacts' ? ['lead', 'customer'] : ['open', 'done']).map((value) => <option key={value}>{value}</option>)}</select>}
        </div>
        {items.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No records match this filter.</p> : items.map((item) => <article key={item.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <div><strong>{display(item)}</strong><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{secondary(item)}</div></div>
          <div style={{ display: 'flex', gap: 6, alignSelf: 'start' }}><button style={button} onClick={() => edit(item)}>Edit</button><button style={button} disabled={busy} onClick={() => remove(item)}>Remove</button></div>
        </article>)}
      </section>
      <form onSubmit={save} style={{ ...panel, display: 'grid', gap: 12 }}><h3 style={{ margin: 0 }}>{editingId ? 'Edit' : 'Add'} {singular(kind)}</h3>
        {fields[kind].map(([field, label]) => {
          const choices = options(field);
          const value = form[field] ?? '';
          return <label key={field} style={{ display: 'grid', gap: 5, fontSize: 13 }}>{label}
            {choices.length > 0 || ['company_id', 'contact_id', 'deal_id', 'stage', 'status'].includes(field) ? <select style={input} value={value} onChange={(event) => setValue(field, event.target.value)}><option value="">{['company_id', 'contact_id', 'deal_id'].includes(field) ? 'None' : 'Choose'}</option>{choices.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
              : field === 'notes' ? <textarea style={{ ...input, minHeight: 65 }} maxLength={4000} value={value} onChange={(event) => setValue(field, event.target.value)} />
              : <input style={input} type={field === 'expected_close_date' ? 'date' : field === 'due_at' ? 'datetime-local' : field === 'amount_minor' ? 'number' : 'text'} min={field === 'amount_minor' ? 0 : undefined} required={field === required(kind)} value={value} onChange={(event) => setValue(field, event.target.value)} />}
          </label>;
        })}
        <div style={{ display: 'flex', gap: 8 }}><button style={button} type="submit" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Create'}</button>{editingId && <button style={button} type="button" onClick={cancel}>Cancel</button>}</div>
      </form>
    </div>
  </div>;
};
