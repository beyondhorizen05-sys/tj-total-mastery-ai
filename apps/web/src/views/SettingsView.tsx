import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { PersonaSettings } from '../components/PersonaSettings';
import { THEMES, loadTheme, setTheme, type ThemeId } from '../themes';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fishKey, setFishKey] = useState('');
  const [fishStatus, setFishStatus] = useState('');
  const [allowedRoots, setAllowedRoots] = useState<string[]>([]);
  const [rootDraft, setRootDraft] = useState('');
  const [rootStatus, setRootStatus] = useState('');
  const [rootLoading, setRootLoading] = useState(true);
  const [rootLoadError, setRootLoadError] = useState('');
  const [profile, setProfile] = useState<{ display_name: string; locale: string; time_zone: string } | null>(null);
  const [theme, chooseTheme] = useState<ThemeId>(loadTheme);

  const load = () => {
    apiFetch<{ settings: Record<string, any> }>('/api/v1/settings').then((r) => setSettings(r.settings)).catch((reason) => setError(reason.message ?? 'Could not load settings'));
  };

  useEffect(() => { load(); }, []);
  const loadAllowedRoots = useCallback(async () => {
    setRootLoading(true); setRootLoadError('');
    try { setAllowedRoots((await apiFetch<{ roots: string[] }>('/api/v1/security/allowed-roots')).roots); }
    catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Could not load trusted folders';
      setRootLoadError(message.includes('Unexpected token') || message.includes('<!doctype')
        ? 'Trusted-folder settings need the current TJ API. Restart TJ to load this feature.'
        : message);
    } finally { setRootLoading(false); }
  }, []);

  useEffect(() => { void loadAllowedRoots(); }, [loadAllowedRoots]);
  useEffect(() => { void apiFetch<{ profile: { display_name: string; locale: string; time_zone: string } | null }>('/api/v1/system/setup').then((result) => setProfile(result.profile)).catch((reason) => setError(reason.message ?? 'Could not load profile')); }, []);

  const changeLocale = async (locale: string) => {
    if (!profile) return;
    setSaving(true); setError(null);
    try {
      const result = await apiFetch<{ profile: { display_name: string; locale: string; time_zone: string } }>('/api/v1/system/profile', { method: 'PUT', body: JSON.stringify({ ...profile, locale }) });
      setProfile(result.profile);
      window.dispatchEvent(new Event('tj:locale-changed'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save language'); }
    finally { setSaving(false); }
  };

  const updateSetting = async (key: string, value: any) => {
    setSaving(true);
    setError(null);
    try {
      await apiFetch('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
      load();
    } catch (e: any) {
      setError(e.message ?? 'Could not save setting');
    } finally {
      setSaving(false);
    }
  };

  const connectFish = async () => {
    setSaving(true); setError(null); setFishStatus('');
    try {
      const result = await apiFetch<{ voices: Array<{ name: string }> }>('/api/v1/voice/fish/config', { method: 'PUT', body: JSON.stringify({ api_key: fishKey.trim() }) });
      setFishKey(''); setFishStatus(`Connected. ${result.voices.length} personal voices loaded. Select one in TJ Identity above.`);
      load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Fish Audio connection failed'); }
    finally { setSaving(false); }
  };

  const addAllowedRoot = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setRootStatus('');
    try {
      const result = await apiFetch<{ roots: string[] }>('/api/v1/security/allowed-roots', { method: 'POST', body: JSON.stringify({ path: rootDraft.trim() }) });
      setAllowedRoots(result.roots); setRootDraft(''); setRootStatus('Folder added. TJ can now access it under the existing file permissions.');
    } catch (reason) { setRootStatus(reason instanceof Error ? reason.message : 'Could not add folder'); }
    finally { setSaving(false); }
  };

  const removeAllowedRoot = async (root: string) => {
    setSaving(true); setRootStatus('');
    try {
      const result = await apiFetch<{ roots: string[] }>(`/api/v1/security/allowed-roots?path=${encodeURIComponent(root)}`, { method: 'DELETE' });
      setAllowedRoots(result.roots); setRootStatus('Folder access removed.');
    } catch (reason) { setRootStatus(reason instanceof Error ? reason.message : 'Could not remove folder'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', maxWidth: 650 }}>
      <h2 style={{ marginBottom: 8 }}>System Settings & Governance</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Control the autonomy level and whether models and network tools may use cloud services.
      </p>
      {error && <p role="alert" style={{ color: '#fb7185', marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section className="tj-theme-section">
          <div className="tj-theme-heading"><span>APPEARANCE / 01</span><h3>Choose your atmosphere</h3><p>Ten live themes. Your choice stays on this device.</p></div>
          <div className="tj-theme-grid">
            {THEMES.map((item) => <button key={item.id} data-theme-id={item.id} type="button" className={`tj-theme-option ${theme === item.id ? 'is-active' : ''}`} aria-pressed={theme === item.id} onClick={() => { chooseTheme(item.id); setTheme(item.id); }}>
              <span className="tj-theme-preview" style={{ background: item.colors[0] }}><i style={{ background: item.colors[1] }} /><b style={{ background: item.colors[2] }} /><em style={{ borderColor: item.colors[1] }} /></span>
              <strong>{item.name}</strong><small>{item.description}</small>
            </button>)}
          </div>
        </section>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Language / زبان</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Choose the language used for primary navigation and welcome. TJ replies in the language you speak or type when a model is available.</p>
          <select aria-label="Interface language" value={profile?.locale ?? 'en-US'} disabled={saving || !profile} onChange={(event) => void changeLocale(event.target.value)} style={{ background: 'var(--bg-card)', color: '#fff', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: 9 }}>
            <option value="en-US">English</option><option value="ur-PK">اردو</option><option value="ur-Latn-PK">Roman Urdu</option>
          </select>
        </div>
        <PersonaSettings />
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Hands-free computer control</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Allow TJ to observe and operate local Windows apps. Use Voice Control to start or pause multilingual listening. Once started, TJ remembers that choice for its next launch.</p>
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={settings.computer_control_enabled === true} disabled={saving} onChange={(event) => void updateSetting('computer_control_enabled', event.target.checked)} /> Enable Windows computer tools</label>
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: 'pointer', marginTop: 12 }}><input type="checkbox" checked={settings.voice_use_default_model === true} disabled={saving} onChange={(event) => void updateSetting('voice_use_default_model', event.target.checked)} /> Use my selected default AI model for voice</label>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>Off uses available free models. Turn on after choosing a paid model in Models; provider charges may apply.</p>
        </div>
        <section aria-labelledby="file-roots-heading" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 id="file-roots-heading" style={{ fontSize: '1rem', marginBottom: 6 }}>Trusted file folders</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>The active project and TJ artifact folders are already available. Add specific folders you trust; requests outside them still ask for approval. Use an absolute Windows path, such as <code>C:\\Users\\You\\Documents</code>.</p>
          <form onSubmit={(event) => void addAllowedRoot(event)} style={{ display: 'flex', gap: 8 }}>
            <input aria-label="Absolute folder path to allow" value={rootDraft} onChange={(event) => setRootDraft(event.target.value)} placeholder="C:\\Users\\You\\Documents" disabled={saving} style={{ flex: 1, minWidth: 0, background: 'var(--bg-card)', color: '#fff', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: 9 }} />
            <button type="submit" disabled={saving || rootLoading || !!rootLoadError || !rootDraft.trim()} style={{ background: 'var(--accent-cyan)', color: '#001216', border: 0, borderRadius: 5, padding: '8px 12px', fontWeight: 700, cursor: 'pointer' }}>Add folder</button>
          </form>
          {rootLoadError && <p role="alert" style={{ color: '#fb7185', fontSize: 12, marginTop: 8 }}>{rootLoadError} <button type="button" disabled={rootLoading} onClick={() => void loadAllowedRoots()} style={{ marginLeft: 6, background: 'transparent', color: 'inherit', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: '4px 7px', cursor: 'pointer' }}>Retry</button></p>}
          {rootStatus && <p role={rootStatus.includes('Folder added') || rootStatus.includes('removed') ? 'status' : 'alert'} style={{ color: rootStatus.includes('Folder added') || rootStatus.includes('removed') ? 'var(--accent-cyan)' : '#fb7185', fontSize: 12, marginTop: 8 }}>{rootStatus}</p>}
          {rootLoading ? <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading trusted folders…</p> : rootLoadError ? null : allowedRoots.length ? <ul aria-label="Trusted folders" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>{allowedRoots.map((root) => <li key={root} style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: 9, border: '1px solid var(--border-subtle)', borderRadius: 6 }}><code style={{ overflowWrap: 'anywhere', fontSize: 12 }}>{root}</code><button type="button" disabled={saving} aria-label={`Remove trusted folder ${root}`} onClick={() => void removeAllowedRoot(root)} style={{ flex: 'none', background: 'transparent', color: '#fb7185', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: '6px 9px', cursor: 'pointer' }}>Remove</button></li>)}</ul> : <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 0 }}>No extra folders added.</p>}
        </section>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Fish Audio voice and multilingual listening</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Your API key is kept in TJ’s encrypted local vault. TJ fetches only voices owned by your Fish Audio workspace. On this computer, transcription runs locally; Fish Audio generates the selected cloned voice.</p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Local speech recognition
            <select value={settings.voice_recognition_mode ?? 'fast'} disabled={saving} onChange={(event) => void updateSetting('voice_recognition_mode', event.target.value)} style={{ background: 'var(--bg-card)', color: '#fff', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: 9 }}>
              <option value="fast">Fast conversation (tiny multilingual model)</option>
              <option value="accurate">Higher accuracy (base multilingual model)</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>Replace API key<input type="password" autoComplete="off" value={fishKey} onChange={(event) => setFishKey(event.target.value)} placeholder="Leave blank to keep your saved key" style={{ background: 'var(--bg-card)', color: '#fff', border: '1px solid var(--border-subtle)', borderRadius: 5, padding: 9 }} /></label>
          <button type="button" disabled={saving || !fishKey.trim()} onClick={() => void connectFish()} style={{ marginTop: 10, background: 'rgba(0,242,254,.16)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)', borderRadius: 5, padding: '8px 12px', cursor: 'pointer' }}>Connect Fish Audio</button>
          {fishStatus && <p role="status" style={{ color: 'var(--accent-cyan)', fontSize: 12, marginTop: 8 }}>{fishStatus}</p>}
        </div>
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Notifications</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>Show approvals and failed work in TJ. Browser alerts also need browser permission.</p>
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={settings.notifications_enabled !== false} disabled={saving} onChange={(event) => void updateSetting('notifications_enabled', event.target.checked)} /> Show event alerts</label>
        </div>
        {/* Autonomy Level */}
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Autonomy Level</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            Determines when tools and file modifications require human approval.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { val: 0, label: 'Chat only', detail: 'Answers without using tools.' },
              { val: 1, label: 'Read-only', detail: 'Can inspect and retrieve information; cannot write or act.' },
              { val: 2, label: 'Draft', detail: 'Can prepare sandbox drafts; outside or higher-risk changes ask first.' },
              { val: 3, label: 'Supervised', detail: 'Routine low-risk operations can run automatically.' },
              { val: 4, label: 'Workflow', detail: 'Pre-authorized low/medium-risk workflow actions can run.' },
              { val: 5, label: 'Privileged', detail: 'Broader routine actions; optionally allow high-risk actions below. Critical actions still require approval.' },
            ].map((lvl) => (
              <button
                key={lvl.val}
                type="button"
                aria-pressed={settings.autonomy_level === lvl.val}
                title={lvl.detail}
                onClick={() => updateSetting('autonomy_level', lvl.val)} disabled={saving}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: settings.autonomy_level === lvl.val ? 'var(--accent-blue)' : 'var(--bg-card)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {lvl.label}
              </button>
            ))}
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
            {[
              { val: 0, detail: 'Chat-only mode denies every tool, including read tools.' },
              { val: 1, detail: 'Read-only mode permits eligible reads but blocks actions and writes.' },
              { val: 2, detail: 'Draft mode permits low-risk work and sandbox drafts; other writes ask first.' },
              { val: 3, detail: 'Supervised mode auto-runs eligible low-risk work; higher-risk actions ask first.' },
              { val: 4, detail: 'Workflow mode allows eligible medium-risk operations; high-risk actions still ask first.' },
              { val: 5, detail: 'Privileged mode allows routine work. You may separately enable automatic high-risk approval below; critical actions stay gated.' },
            ].find((level) => level.val === settings.autonomy_level)?.detail ?? 'Unknown autonomy level; tools should remain gated.'}
          </p>
          <div style={{ marginTop: 16, padding: 12, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: settings.autonomy_level === 5 ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={settings.auto_approve_high_risk === true}
                disabled={saving || settings.autonomy_level !== 5}
                onChange={(event) => void updateSetting('auto_approve_high_risk', event.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Full Autonomy — auto-approve high-risk actions</strong>
                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 5 }}>
                  Opt in to authorized high-risk tool use and project-scoped shell commands without repeated approval popups.
                  Critical actions, explicit denials, and access outside trusted folders still require approval or remain blocked.
                  STOP ALL and audit logging remain active.
                </span>
              </span>
            </label>
            {settings.autonomy_level !== 5 && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: 9, marginBottom: 0 }}>Select Privileged above to configure Full Autonomy. It is off by default.</p>
            )}
            {settings.autonomy_level === 5 && settings.auto_approve_high_risk === true && (
              <p role="status" style={{ color: '#fbbf24', fontSize: '0.78rem', marginTop: 9, marginBottom: 0 }}>High-risk auto-approval is ON. Actions such as authorized file deletion, external publishing, or sending messages may execute without prompting. Disable this switch to restore the normal approval gate.</p>
            )}
          </div>
        </div>

        {/* Privacy Mode */}
        <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 6 }}>Privacy Mode</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            Strict local-only mode rejects cloud LLMs and outbound network tools.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: 'balanced', label: 'Balanced (Local + Cloud)' },
              { val: 'local-only', label: 'Local-Only' },
            ].map((p) => (
              <button
                key={p.val}
                onClick={() => updateSetting('privacy_mode', p.val)} disabled={saving}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: settings.privacy_mode === p.val ? 'var(--accent-cyan)' : 'var(--bg-card)',
                  color: settings.privacy_mode === p.val ? '#000' : '#fff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
