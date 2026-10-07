import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Sliders, Shield, Power } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    apiFetch<{ settings: Record<string, any> }>('/api/v1/settings').then((r) => setSettings(r.settings));
  };

  useEffect(() => { load(); }, []);

  const updateSetting = async (key: string, value: any) => {
    setSaving(true);
    try {
      await apiFetch('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ [key]: value }),
      });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto', maxWidth: 650 }}>
      <h2 style={{ marginBottom: 8 }}>System Settings & Governance</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Control autonomy levels, privacy policies, fallback thresholds, and runtime safety parameters.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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
                onClick={() => updateSetting('autonomy_level', lvl.val)}
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
              { val: 'local-only', label: 'Local-Only (Air-Gapped)' },
            ].map((p) => (
              <button
                key={p.val}
                onClick={() => updateSetting('privacy_mode', p.val)}
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
