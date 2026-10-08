import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Search, Trash2 } from 'lucide-react';
import type { Memory } from '@tj/schemas';

export const MemoryView: React.FC = () => {
  const [items, setItems] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [newMemory, setNewMemory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    apiFetch<{ items: Memory[] }>('/api/v1/memory/items').then((r) => setItems(r.items)).catch((reason) => setError(reason.message ?? 'Could not load memories'));
  };

  useEffect(() => { load(); }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) { load(); return; }
    setSearching(true);
    try {
      const res = await apiFetch<{ results: Array<{ memory: Memory }> }>(`/api/v1/memory/search?q=${encodeURIComponent(query)}`);
      setItems(res.results.map((r) => r.memory));
    } catch (e: any) {
      setError(e.message ?? 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (id: string) => {
    try { await apiFetch(`/api/v1/memory/items/${id}`, { method: 'DELETE' }); load(); }
    catch (reason: any) { setError(reason.message ?? 'Could not delete memory'); }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newMemory.trim()) return;
    setSaving(true); setError(null);
    try {
      await apiFetch('/api/v1/memory/items', { method: 'POST', body: JSON.stringify({ type: 'preference', content: newMemory.trim(), source: 'user' }) });
      setNewMemory(''); load();
    } catch (reason: any) { setError(reason.message ?? 'Could not save memory'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Long-Term & Hybrid Memory</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Searchable knowledge store with provenance. Semantic matching is used only when an embedding model and stored vectors are available.
      </p>
      {error && <p role="alert" style={{ color: '#fb7185', marginBottom: 12 }}>{error}</p>}

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, marginBottom: 16, maxWidth: 650 }}>
        <input value={newMemory} onChange={(event) => setNewMemory(event.target.value)} placeholder="Save a preference or fact for TJ to remember…" style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-main)' }} />
        <button type="submit" disabled={saving || !newMemory.trim()} style={{ padding: '0 14px', color: '#fff', background: 'var(--accent-blue)', border: 0, borderRadius: 6, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save memory'}</button>
      </form>

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 24, maxWidth: 500 }}>
        <input
          type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories via FTS5..."
          style={{ flex: 1, padding: '10px 14px', background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none' }}
        />
        <button
          type="submit" disabled={searching}
          style={{ padding: '0 16px', background: 'var(--border-strong)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Search size={16} /> Search
        </button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((m) => (
          <div key={m.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'var(--border-strong)', color: 'var(--accent-cyan)' }}>
                  {m.type}
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Sensitivity: {m.sensitivity}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Owner: {m.owner}</span>
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.5 }}>{m.content}</div>
            </div>
            <button
              onClick={() => handleDelete(m.id)}
              style={{ background: 'transparent', border: 'none', color: '#fb7185', cursor: 'pointer', padding: 4 }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
