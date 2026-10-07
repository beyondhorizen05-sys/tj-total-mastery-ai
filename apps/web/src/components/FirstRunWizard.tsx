import React, { useState } from 'react';
import { apiFetch } from '../api';
import { Sparkles, Shield, Cpu, ArrowRight } from 'lucide-react';

export const FirstRunWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<'openai' | 'anthropic' | 'ollama'>('ollama');
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async () => {
    setSubmitting(true);
    try {
      if (provider !== 'ollama' && apiKey) {
        await apiFetch('/api/v1/models/providers', {
          method: 'POST',
          body: JSON.stringify({
            name: provider === 'openai' ? 'OpenAI' : 'Anthropic',
            kind: provider,
            preset: provider,
            api_key: apiKey,
          }),
        });
      }
      await apiFetch('/api/v1/system/first-run', { method: 'POST', body: JSON.stringify({ completed: true }) });
      onComplete();
    } catch {
      onComplete();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(5,7,15,0.95)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }}>
      <div style={{
        width: 460, background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
        borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkles size={22} color="var(--accent-cyan)" />
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Welcome to TJ</h3>
        </div>

        {step === 1 ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
              Total Mastery AI is your local-first autonomous agent operating environment.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem' }}>
              <div style={{ display: 'flex', gap: 8 }}><Shield size={16} color="var(--accent-emerald)" /> Deny-by-default execution safety</div>
              <div style={{ display: 'flex', gap: 8 }}><Cpu size={16} color="var(--accent-purple)" /> Multi-provider fallback and local Ollama</div>
            </div>
            <button
              onClick={() => setStep(2)}
              style={{ padding: '8px 14px', borderRadius: 6, background: 'var(--accent-cyan)', color: '#000', fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              Configure <ArrowRight size={14} />
            </button>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['ollama', 'openai', 'anthropic'] as const).map((p) => (
                <button
                  key={p} onClick={() => setProvider(p)}
                  style={{ flex: 1, padding: '6px', borderRadius: 4, border: '1px solid var(--border-subtle)', background: provider === p ? 'var(--accent-cyan-dim)' : 'transparent', color: provider === p ? 'var(--accent-cyan)' : 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer', textTransform: 'capitalize' }}
                >
                  {p}
                </button>
              ))}
            </div>
            {provider !== 'ollama' && (
              <input
                type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter API Key..."
                style={{ width: '100%', padding: '8px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)', fontSize: '0.8rem' }}
              />
            )}
            <button
              onClick={handleFinish} disabled={submitting}
              style={{ padding: '8px 14px', borderRadius: 6, background: 'var(--accent-cyan)', color: '#000', fontWeight: 700, border: 'none', cursor: 'pointer' }}
            >
              {submitting ? 'Saving...' : 'Finish & Launch'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
