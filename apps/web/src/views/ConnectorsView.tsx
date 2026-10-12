import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Connector, CapabilityStatus } from '@tj/schemas';
import { CheckCircle2, ChevronDown, ExternalLink, PlugZap, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '../api';
import { HealthBadge, StatusBadge } from '../components/Badges';
import { BrandLogo } from '../components/BrandLogo';
import './connectors-view.css';

type PlannedConnector = { id: string; name: string; category: string; note: string };
type ConnectorResponse = { connectors: Connector[]; planned: PlannedConnector[] };
type ActionResult = { ok: boolean; detail: string };
type CatalogEntry = { kind: 'ready'; connector: Connector } | { kind: 'planned'; connector: PlannedConnector };

const setupStatuses = new Set<CapabilityStatus>(['NEEDS_API_KEY', 'NEEDS_SETUP', 'NEEDS_DEVICE', 'UNAVAILABLE']);
const validationOnlyIds = new Set(['slack_webhook', 'generic_webhook']);
const statusLabels: Record<string, string> = {
  CONNECTED: 'Connected', AVAILABLE: 'Available', NEEDS_API_KEY: 'Needs API key',
  NEEDS_SETUP: 'Needs setup', NEEDS_DEVICE: 'Needs device', UNAVAILABLE: 'Unavailable',
  EXPERIMENTAL: 'Experimental', LOCAL_ONLY: 'Local only', CLOUD_ONLY: 'Cloud only', PLANNED: 'Planned',
};

export const ConnectorsView: React.FC = () => {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [planned, setPlanned] = useState<PlannedConnector[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, ActionResult>>({});
  const [configResult, setConfigResult] = useState<Record<string, ActionResult>>({});
  const [announcement, setAnnouncement] = useState<{ id: string; connector: string; result: ActionResult } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiFetch<ConnectorResponse>('/api/v1/connectors');
      setConnectors(response.connectors ?? []);
      setPlanned(response.planned ?? []);
      setLoadError(null);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'Could not load connectors');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const categories = useMemo(() => [...new Set([...connectors, ...planned].map((item) => item.category))].sort(), [connectors, planned]);
  const statuses = useMemo(() => [...new Set(connectors.map((item) => item.status))].sort(), [connectors]);
  const entries = useMemo<CatalogEntry[]>(() => [
    ...connectors.map((connector): CatalogEntry => ({ kind: 'ready', connector })),
    ...planned.map((connector): CatalogEntry => ({ kind: 'planned', connector })),
  ], [connectors, planned]);
  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (category !== 'all' && entry.connector.category !== category) return false;
      if (status !== 'all' && (entry.kind === 'planned' ? 'PLANNED' : entry.connector.status) !== status) return false;
      if (!term) return true;
      const content = entry.kind === 'planned'
        ? `${entry.connector.name} ${entry.connector.category} ${entry.connector.note}`
        : `${entry.connector.name} ${entry.connector.provider} ${entry.connector.category} ${entry.connector.description} ${entry.connector.scopes.join(' ')} ${entry.connector.actions.map((action) => action.name).join(' ')}`;
      return content.toLocaleLowerCase().includes(term);
    });
  }, [entries, search, category, status]);

  useEffect(() => {
    if (announcement && document.activeElement === document.body && !visible.some((entry) => entry.kind === 'ready' && entry.connector.id === announcement.id)) {
      searchRef.current?.focus();
    }
  }, [announcement, visible]);

  const saveConfig = async (id: string, values: Record<string, string>, clearedField?: string) => {
    setSaving(id);
    setAnnouncement(null);
    setConfigResult((current) => { const next = { ...current }; delete next[id]; return next; });
    try {
      await apiFetch(`/api/v1/connectors/${encodeURIComponent(id)}/config`, { method: 'PUT', body: JSON.stringify(values) });
      setDraft((current) => {
        if (!clearedField) return { ...current, [id]: {} };
        const fields = { ...current[id] };
        delete fields[clearedField];
        return { ...current, [id]: fields };
      });
      const result = { ok: true, detail: clearedField ? 'Saved value removed.' : 'Configuration saved. Test the connection to verify it.' };
      setConfigResult((current) => ({ ...current, [id]: result }));
      setAnnouncement({ id, connector: connectors.find((item) => item.id === id)?.name ?? id, result });
      setTestResult((current) => { const next = { ...current }; delete next[id]; return next; });
      await load();
    } catch (reason) {
      const result = { ok: false, detail: reason instanceof Error ? reason.message : 'Could not save configuration' };
      setConfigResult((current) => ({ ...current, [id]: result }));
      setAnnouncement({ id, connector: connectors.find((item) => item.id === id)?.name ?? id, result });
    } finally {
      setSaving(null);
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setAnnouncement(null);
    setTestResult((current) => { const next = { ...current }; delete next[id]; return next; });
    try {
      const result = await apiFetch<ActionResult>(`/api/v1/connectors/${encodeURIComponent(id)}/test`, { method: 'POST' });
      setTestResult((current) => ({ ...current, [id]: result }));
      setAnnouncement({ id, connector: connectors.find((item) => item.id === id)?.name ?? id, result });
      await load();
    } catch (reason) {
      const result = { ok: false, detail: reason instanceof Error ? reason.message : 'Connection test failed' };
      setTestResult((current) => ({ ...current, [id]: result }));
      setAnnouncement({ id, connector: connectors.find((item) => item.id === id)?.name ?? id, result });
    } finally {
      setTesting(null);
    }
  };

  const connectedCount = connectors.filter((item) => item.status === 'CONNECTED' && !validationOnlyIds.has(item.id)).length;
  const availableCount = connectors.filter((item) => item.status === 'AVAILABLE').length;
  const setupCount = connectors.filter((item) => setupStatuses.has(item.status)).length;

  return <main className="tj-connectors-view">
    <header className="tj-connectors-hero">
      <div className="tj-connectors-hero-copy">
        <span className="tj-connectors-kicker"><PlugZap size={15} aria-hidden="true" /> TJ / CONNECTOR MARKETPLACE</span>
        <h1>Connect your world.</h1>
        <p>Explore installed integrations, configure credentials in TJ’s vault, and check real connection health.</p>
      </div>
      <div className="tj-connectors-summary" aria-label="Connector catalog summary">
        <div><strong>{connectedCount}</strong><span>Connected</span></div>
        <div><strong>{availableCount}</strong><span>Available</span></div>
        <div><strong>{setupCount}</strong><span>Needs setup</span></div>
        <div><strong>{planned.length}</strong><span>Planned</span></div>
      </div>
    </header>

    <section className="tj-connectors-catalog" aria-labelledby="connector-catalog-heading">
      <div className="tj-connectors-toolbar">
        <div><span className="tj-connectors-kicker">INSTALLED & ROADMAP</span><h2 id="connector-catalog-heading">Connector catalog</h2><p>Live status comes from the local API. Planned integrations have no runtime yet.</p></div>
        <button className="tj-connectors-refresh" type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'is-spinning' : ''} aria-hidden="true" />{loading ? 'Refreshing…' : 'Refresh status'}</button>
      </div>

      <div className="tj-connectors-filters">
        <label className="tj-connectors-search"><Search size={17} aria-hidden="true" /><span className="tj-connectors-sr-only">Search connectors</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, provider, purpose, or action" /></label>
        <label className="tj-connectors-filter"><SlidersHorizontal size={15} aria-hidden="true" /><span className="tj-connectors-sr-only">Category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></label>
        <label className="tj-connectors-filter"><span className="tj-connectors-sr-only">Connection status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{statusLabels[item] ?? item.replaceAll('_', ' ')}</option>)}{planned.length > 0 && <option value="PLANNED">Planned</option>}</select><ChevronDown size={14} aria-hidden="true" /></label>
      </div>

      <div className="tj-connectors-result-line" role="status">{visible.length} of {entries.length} integrations shown</div>
      {announcement && <p className={`tj-connectors-announcement ${announcement.result.ok ? 'is-success' : 'is-error'}`} role={announcement.result.ok ? 'status' : 'alert'} aria-atomic="true"><strong>{announcement.connector}:</strong> {announcement.result.detail}</p>}
      {loadError && <p className="tj-connectors-error" role="alert">Could not refresh connector status: {loadError}. Showing the latest available catalog.</p>}
      {!loading && entries.length === 0 && <p className="tj-connectors-empty">No connectors are registered by the local API.</p>}
      {entries.length > 0 && visible.length === 0 && <div className="tj-connectors-empty"><strong>No matches found.</strong><p>Try another search, category, or status.</p><button type="button" onClick={() => { setSearch(''); setCategory('all'); setStatus('all'); searchRef.current?.focus(); }}>Clear filters</button></div>}

      <div className="tj-connectors-grid" aria-busy={loading}>
        {visible.map((entry) => {
          if (entry.kind === 'planned') {
            const item = entry.connector;
            return <article className="tj-connector-card is-planned" key={`planned-${item.id}`}>
              <div className="tj-connector-card-head"><BrandLogo id={item.id} name={item.name} className="tj-connector-icon" /><div><small>{item.category.replaceAll('_', ' ')} / ROADMAP</small><h3>{item.name}</h3></div><StatusBadge status="PLANNED" /></div>
              <p>{item.note}</p><div className="tj-connector-planned-note">Planned integration · no configuration or test available</div>
            </article>;
          }

          const item = entry.connector;
          const isExpanded = expanded === item.id;
          const draftValues = draft[item.id] ?? {};
          const configured = new Set(item.configured_keys);
          const busy = saving === item.id || testing === item.id;
          const validationOnly = validationOnlyIds.has(item.id);
          return <article className="tj-connector-card" key={item.id}>
            <div className="tj-connector-card-head"><BrandLogo id={item.id} name={item.name} fallback={item.icon} className="tj-connector-icon" /><div><small>{item.provider} / {item.category.replaceAll('_', ' ')}</small><h3>{item.name}</h3></div>{validationOnly && item.status === 'CONNECTED' ? <span className="tj-connector-validation-badge">CONFIG VALIDATED</span> : <StatusBadge status={item.status} />}</div>
            <p>{item.description}</p>
            <div className="tj-connector-meta"><HealthBadge health={item.health} /><span>{item.actions.length} {item.actions.length === 1 ? 'action' : 'actions'}</span>{item.last_checked_at && <span>Checked {new Date(item.last_checked_at).toLocaleString()}</span>}</div>
            {validationOnly && <p className="tj-connector-validation-note">Validation checks the configured URL format; it does not contact the destination.</p>}
            {item.missing && <p className="tj-connector-missing">Requires: {item.missing}</p>}
            {item.last_error && <p className="tj-connector-error">Last check: {item.last_error}</p>}
            <div className="tj-connector-card-actions">
              {item.config_fields.length > 0 && <button type="button" className="tj-connector-config-toggle" aria-label={`${isExpanded ? 'Hide setup for' : configured.size ? 'Manage setup for' : 'Configure'} ${item.name}`} aria-expanded={isExpanded} aria-controls={isExpanded ? `connector-config-${item.id}` : undefined} onClick={() => setExpanded(isExpanded ? null : item.id)}>{isExpanded ? 'Hide setup' : configured.size ? 'Manage setup' : 'Configure'} <ChevronDown size={14} aria-hidden="true" /></button>}
              <button type="button" aria-label={`${testing === item.id ? 'Testing' : validationOnly ? 'Validate setup for' : 'Test connection for'} ${item.name}`} onClick={() => void handleTest(item.id)} disabled={busy}>{testing === item.id ? 'Testing…' : validationOnly ? 'Validate setup' : 'Test connection'}</button>
              {item.docs_url && <a href={item.docs_url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.name} documentation in a new tab`}>Docs <ExternalLink size={13} aria-hidden="true" /></a>}
            </div>
            {testResult[item.id] && <p className={`tj-connector-feedback ${testResult[item.id].ok ? 'is-success' : 'is-error'}`}>{testResult[item.id].detail}</p>}
            {item.config_fields.length > 0 && isExpanded && <div className="tj-connector-config" id={`connector-config-${item.id}`}>
              <div className="tj-connector-config-head"><ShieldCheck size={16} aria-hidden="true" /><div><strong>Connection setup</strong><span>{item.privacy}</span></div></div>
              {item.config_fields.map((field) => <div className="tj-connector-field" key={field.key}>
                <label htmlFor={`${item.id}-${field.key}`}>{field.label}{field.required ? ' *' : ''}{configured.has(field.key) && <span className="tj-connector-saved"><CheckCircle2 size={12} aria-hidden="true" /> Saved</span>}</label>
                <input id={`${item.id}-${field.key}`} aria-describedby={field.help ? `${item.id}-${field.key}-help` : undefined} type={field.secret ? 'password' : 'text'} autoComplete="off" value={draftValues[field.key] ?? ''} placeholder={configured.has(field.key) ? 'Leave blank to keep saved value' : field.placeholder ?? ''} onChange={(event) => setDraft((current) => ({ ...current, [item.id]: { ...current[item.id], [field.key]: event.target.value } }))} />
                {field.help && <small id={`${item.id}-${field.key}-help`}>{field.help}</small>}
                {configured.has(field.key) && <button className="tj-connector-remove" type="button" aria-label={`Remove saved ${field.label} for ${item.name}`} disabled={busy} onClick={() => void saveConfig(item.id, { [field.key]: '' }, field.key)}>Remove saved value</button>}
              </div>)}
              <button className="tj-connector-save" type="button" disabled={busy || !Object.values(draftValues).some((value) => value.trim())} onClick={() => void saveConfig(item.id, draftValues)}>{saving === item.id ? 'Saving…' : 'Save configuration'}</button>
              {configResult[item.id] && <p className={`tj-connector-feedback ${configResult[item.id].ok ? 'is-success' : 'is-error'}`}>{configResult[item.id].detail}</p>}
            </div>}
          </article>;
        })}
      </div>
    </section>
  </main>;
};
