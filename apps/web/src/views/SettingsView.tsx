import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { PersonaSettings } from '../components/PersonaSettings';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fishKey, setFishKey] = useState('');
  const [fishStatus, setFishStatus] = useState('');
  const [profile, setProfile] = useState<{ display_name: string; locale: string; time_zone: string } | null>(null);

  const load = () => {
    apiFetch<{ settings: Record<string, any> }>('/api/v1/settings').then((r) => setSettings(r.settings)).catch((reason) => setError(reason.message ?? 'Could not load settings'));
  };

  useEffect(() => { load(); }, []);
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

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', maxWidth: 650 }}>
      <h2 style={{ marginBottom: 8 }}>System Settings & Governance</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Control the autonomy level and whether models and network tools may use cloud services.
      </p>
      {error && <p role="alert" style={{ color: '#fb7185', marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { val: 1, label: 'Read-Only' },
              { val: 2, label: 'Draft (Default)' },
              { val: 3, label: 'Supervised' },
              { val: 4, label: 'Autonomous' },
            ].map((lvl) => (
              <button
                key={lvl.val}
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
