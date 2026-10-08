import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Manifest = {
  id: string; version: string; description: string;
  input_schema: { properties: Record<string, { type: 'string'; maxLength?: number }>; required: string[] };
  permissions: string[]; network_access: boolean; file_access: boolean; os_privileges: boolean;
  execution: { method: string; template: string };
};
type Skill = { manifest: Manifest; digest: string; enabled: boolean; reviewed_at: string | null };
type CatalogEntry = { filename: string; manifest?: Manifest; error?: string };
type SkillRun = { id: string; skill_id: string; status: string; timestamp: string; error?: string };

const box: React.CSSProperties = { padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 10, background: 'var(--bg-secondary)' };
const button: React.CSSProperties = { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-main)', cursor: 'pointer' };

export const SkillsView: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [runs, setRuns] = useState<SkillRun[]>([]);
  const [manifestText, setManifestText] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    const [installed, discovered, history] = await Promise.all([
      apiFetch<{ skills: Skill[] }>('/api/v1/skills'),
      apiFetch<{ catalog: CatalogEntry[] }>('/api/v1/skills/catalog'),
      apiFetch<{ runs: SkillRun[] }>('/api/v1/skills/runs'),
    ]);
    setSkills(installed.skills); setCatalog(discovered.catalog); setRuns(history.runs);
  };
  useEffect(() => { void load().catch((e) => setError(e.message)); }, []);

  const act = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(false); }
  };

  const selected = skills.find((skill) => skill.manifest.id === selectedId);
  const install = (manifest: unknown) => act(async () => {
    const result = await apiFetch<{ skill: Skill }>('/api/v1/skills', { method: 'POST', body: JSON.stringify(manifest) });
    setSelectedId(result.skill.manifest.id); setNotice(`${result.skill.manifest.id} installed disabled. Review its scope before enabling.`);
  });
  const run = () => selected && act(async () => {
    const result = await apiFetch<{ output: { text: string } }>(`/api/v1/skills/${encodeURIComponent(selected.manifest.id)}/run`, { method: 'POST', body: JSON.stringify({ input: inputs }) });
    setOutput(result.output.text); setNotice('Skill completed.');
  });

  return <div style={{ height: '100%', overflow: 'auto', padding: 16, color: 'var(--text-main)' }}>
    <h2>Local Skills</h2>
    <p style={{ color: 'var(--text-muted)' }}>Install and review declarative text templates. These skills run locally without file, network, OS, or secret access.</p>
    <button style={button} disabled={busy} onClick={() => void act(async () => { setNotice('Catalog refreshed.'); })}>Refresh</button>
    {error && <p role="alert" style={{ color: '#fb7185' }}>{error}</p>}
    {notice && <p role="status" style={{ color: 'var(--accent-cyan)' }}>{notice}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) minmax(300px, 2fr)', gap: 16, marginTop: 16 }}>
      <section style={box}>
        <h3>Installed</h3>
        {skills.length === 0 && <p>No skills installed.</p>}
        {skills.map((skill) => <button key={skill.manifest.id} style={{ ...button, width: '100%', textAlign: 'left', marginBottom: 8, borderColor: selectedId === skill.manifest.id ? 'var(--accent-cyan)' : 'var(--border-subtle)' }} onClick={() => { setSelectedId(skill.manifest.id); setInputs({}); setOutput(''); }}>
          <strong>{skill.manifest.id}</strong> v{skill.manifest.version}<br /><small>{skill.enabled ? 'Enabled' : 'Disabled'} · {skill.manifest.description}</small>
        </button>)}
        <h3>Local catalog</h3>
        {catalog.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No JSON manifests in the local catalog.</p>}
        {catalog.map((entry) => <div key={entry.filename} style={{ marginBottom: 12 }}>
          <div>{entry.manifest?.id ?? entry.filename}</div>
          {entry.error ? <small style={{ color: '#fb7185' }}>{entry.error}</small> : <button style={button} disabled={busy} onClick={() => void act(async () => {
            const result = await apiFetch<{ skill: Skill }>('/api/v1/skills/install-from-catalog', { method: 'POST', body: JSON.stringify({ filename: entry.filename }) });
            setSelectedId(result.skill.manifest.id); setNotice('Installed disabled. Review before enabling.');
          })}>Install disabled</button>}
        </div>)}
      </section>
      <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
        {selected && <section style={box}>
          <h3>{selected.manifest.id} · v{selected.manifest.version}</h3>
          <p>{selected.manifest.description}</p>
          <p>Execution: {selected.manifest.execution.method} · Permissions: {selected.manifest.permissions.length ? selected.manifest.permissions.join(', ') : 'none'} · Network: {String(selected.manifest.network_access)} · Files: {String(selected.manifest.file_access)} · OS: {String(selected.manifest.os_privileges)}</p>
          <details><summary>Review template</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{selected.manifest.execution.template}</pre></details>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={button} disabled={busy || selected.enabled} onClick={() => void act(async () => {
              await apiFetch(`/api/v1/skills/${encodeURIComponent(selected.manifest.id)}/enable`, { method: 'POST', body: JSON.stringify({ reviewed: true }) }); setNotice('Skill enabled after review.');
            })}>I reviewed scope · Enable</button>
            <button style={button} disabled={busy || !selected.enabled} onClick={() => void act(async () => {
              await apiFetch(`/api/v1/skills/${encodeURIComponent(selected.manifest.id)}/disable`, { method: 'POST' }); setNotice('Skill disabled.');
            })}>Disable</button>
          </div>
          <h4>Run</h4>
          {Object.entries(selected.manifest.input_schema.properties).map(([key, spec]) => <label key={key} style={{ display: 'block', marginBottom: 10 }}>{key}{selected.manifest.input_schema.required.includes(key) ? ' *' : ''}<input style={{ display: 'block', width: '100%', marginTop: 4, padding: 8, background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }} value={inputs[key] ?? ''} maxLength={spec.maxLength ?? 4096} onChange={(e) => setInputs((prior) => ({ ...prior, [key]: e.target.value }))} /></label>)}
          <button style={button} disabled={busy || !selected.enabled} onClick={run}>Run skill</button>
          {output && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{output}</pre>}
        </section>}
        <section style={box}>
          <h3>Install manifest JSON</h3>
          <textarea aria-label="Skill manifest JSON" value={manifestText} onChange={(e) => setManifestText(e.target.value)} rows={9} style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }} />
          <button style={button} disabled={busy || !manifestText.trim()} onClick={() => { try { void install(JSON.parse(manifestText)); } catch { setError('Manifest must be valid JSON'); } }}>Validate and install disabled</button>
        </section>
        <section style={box}><h3>Recent runs</h3>{runs.slice(0, 15).map((item) => <div key={item.id}>{item.timestamp} · {item.skill_id} · {item.status}{item.error ? ` · ${item.error}` : ''}</div>)}</section>
      </div>
    </div>
  </div>;
};
