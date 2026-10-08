import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import './CommandPalette.css';

export type PaletteAction = {
  id: string;
  label: string;
  detail: string;
  keywords?: string;
  run: () => void | Promise<void>;
};

export const CommandPalette: React.FC<{ actions: PaletteAction[]; onClose: () => void }> = ({ actions, onClose }) => {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? actions.filter((action) => `${action.label} ${action.detail} ${action.keywords ?? ''}`.toLowerCase().includes(needle)) : actions;
  }, [actions, query]);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setSelected(0); setError(null); }, [query]);

  const activate = async (action: PaletteAction) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action.run(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Action failed'); }
    finally { setBusy(false); }
  };

  return <div className="tj-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="tj-palette" role="dialog" aria-modal="true" aria-label="TJ command palette">
      <div className="tj-palette-search"><Search size={18} aria-hidden="true" /><input ref={input} aria-label="Search commands" placeholder="What would you like to do?" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => Math.min(value + 1, matches.length - 1)); }
        if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
        if (event.key === 'Enter' && matches[selected]) { event.preventDefault(); void activate(matches[selected]); }
      }} /><button type="button" className="tj-palette-close" onClick={onClose} aria-label="Close commands"><X size={18} /></button></div>
      <div className="tj-palette-heading">AVAILABLE ACTIONS <span>CTRL K</span></div>
      <div className="tj-palette-list" role="listbox" aria-label="Available commands">
        {matches.length ? matches.map((action, index) => <button key={action.id} type="button" role="option" aria-selected={selected === index} className={selected === index ? 'selected' : ''} disabled={busy} onMouseEnter={() => setSelected(index)} onClick={() => void activate(action)}><strong>{action.label}</strong><small>{action.detail}</small></button>) : <p className="tj-palette-empty">No matching action is available.</p>}
      </div>
      {error && <p className="tj-palette-error" role="alert">{error}</p>}
      <div className="tj-palette-footer">↑ ↓ Choose <span>↵ Open</span><span>Esc Close</span></div>
    </section>
  </div>;
};
