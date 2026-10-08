import React, { useEffect, useState } from 'react';
import { DEFAULT_TJ_PERSONA, type TJPersona } from '@tj/schemas';
import { apiFetch } from '../api';
import { IdentityScene } from './IdentityScene';
import { VoiceSelector } from './VoiceSelector';

export const PersonaSettings: React.FC = () => {
  const [persona, setPersona] = useState<TJPersona>(DEFAULT_TJ_PERSONA);
  const [saved, setSaved] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { apiFetch<{ persona: TJPersona }>('/api/v1/persona').then((r) => setPersona(r.persona)).catch((e) => setError(e.message)); }, []);
  const update = <K extends keyof TJPersona>(key: K, value: TJPersona[K]) => { setPersona((p) => ({ ...p, [key]: value })); setSaved(false); };
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await apiFetch<{ persona: TJPersona }>('/api/v1/persona', { method: 'PUT', body: JSON.stringify(persona) }); setPersona(r.persona); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  };
  return <section className="glass-panel" style={{ padding: 20, marginBottom: 24 }}>
    <h3 style={{ marginBottom: 6 }}>TJ Identity</h3>
    <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 17 }}>A persistent presentation layer for how TJ looks and speaks to you.</p>
    <div style={{ height: 180, background: 'radial-gradient(circle,#153d65,#060d1c 70%)', borderRadius: 8, marginBottom: 16 }}><IdentityScene embodiment={persona.embodiment} className="tj-settings-identity-scene" /></div>
    <div style={{ display: 'flex', gap: 7, marginBottom: 16 }}>{(['core', 'female', 'male'] as const).map((form) => <button key={form} onClick={() => update('embodiment', form)} style={chip(persona.embodiment === form)}>{form.toUpperCase()}</button>)}</div>
    <div className="tj-identity-grid">
      <label>Assistant name<input value={persona.name} maxLength={32} onChange={(e) => update('name', e.target.value)} /></label>
      <label>Call me<input value={persona.user_address} maxLength={32} placeholder="Optional" onChange={(e) => update('user_address', e.target.value)} /></label>
      <label>Personality<select value={persona.archetype} onChange={(e) => update('archetype', e.target.value as TJPersona['archetype'])}>{['warm', 'executive', 'mentor', 'confident'].map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Communication<select value={persona.communication} onChange={(e) => update('communication', e.target.value as TJPersona['communication'])}>{['concise', 'balanced', 'detailed'].map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Relationship<select value={persona.relationship} onChange={(e) => update('relationship', e.target.value as TJPersona['relationship'])}>{['professional', 'friendly', 'coach', 'girlfriend', 'boyfriend'].map((x) => <option key={x}>{x}</option>)}</select></label>
    </div>
    <div className="tj-traits">{(['warmth', 'directness', 'humor'] as const).map((trait) => <label key={trait}>{trait} <span>{persona[trait]}</span><input type="range" min="0" max="100" value={persona[trait]} onChange={(e) => update(trait, Number(e.target.value))} /></label>)}</div>
    <VoiceSelector value={persona.voice_id} onChange={(voice) => update('voice_id', voice)} previewName={persona.name} />
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 14 }}><input type="checkbox" checked={persona.locked} onChange={(e) => update('locked', e.target.checked)} /> Lock identity changes to your explicit edits</label>
    {error && <p role="alert" style={{ color: 'var(--accent-rose)', fontSize: 12, marginBottom: 10 }}>{error}</p>}
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button onClick={save} disabled={busy || saved || !persona.name.trim()} style={chip(true)}>{busy ? 'Saving…' : saved ? 'Saved' : 'Save identity'}</button><button onClick={() => { window.location.href = `${window.location.pathname}?welcome`; }} style={chip(false)}>Replay welcome</button></div>
    <style>{`.tj-settings-identity-scene{height:100%;width:100%}.tj-identity-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-bottom:16px}.tj-identity-grid label,.tj-traits label{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--text-muted);text-transform:capitalize}.tj-identity-grid input,.tj-identity-grid select{background:var(--bg-secondary);color:var(--text-main);border:1px solid var(--border-subtle);padding:8px;border-radius:5px}.tj-traits{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px}.tj-traits label span{color:var(--accent-cyan)}.tj-traits input{accent-color:var(--accent-cyan)}@media(max-width:650px){.tj-identity-grid,.tj-traits{grid-template-columns:1fr}}`}</style>
  </section>;
};

function chip(selected: boolean): React.CSSProperties { return { background: selected ? 'rgba(0,242,254,.16)' : 'var(--bg-secondary)', color: selected ? 'var(--accent-cyan)' : 'var(--text-muted)', border: `1px solid ${selected ? 'var(--accent-cyan)' : 'var(--border-subtle)'}`, borderRadius: 5, padding: '8px 12px', cursor: 'pointer', fontSize: 12 }; }
