import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Database, Search, Trash2 } from 'lucide-react';

export const MemoryView: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const load = () => {
    apiFetch<{ items: any[] }>('/api/v1/memory/items').then((r) => setItems(r.items));
  };

  useEffect(() => { load(); }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) { load(); return; }
    setSearching(true);
    try {
      const res = await apiFetch<{ results: any[] }>(`/api/v1/memory/search?q=${encodeURIComponent(query)}`);
      setItems(res.results.map((r) => r.memory));
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  const handleDelete = async (id: string) => {
    await apiFetch(`/api/v1/memory/items/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Long-Term & Hybrid Memory</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Searchable knowledge store combining FTS5 full-text indexing, vector similarity ranking, and provenance.
      </p>

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
