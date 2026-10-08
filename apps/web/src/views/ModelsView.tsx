import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Cpu, Plus, Trash2, ExternalLink } from 'lucide-react';

export const ModelsView: React.FC = () => {
  const [chatgptPlan, setChatgptPlan] = useState<{ enabled: boolean; pending: boolean; accounts: Array<{ id: string; email: string | null; name: string | null; connected: boolean }>; active_account_id: string | null; last_error: string | null } | null>(null);
  const [chatgptWorking, setChatgptWorking] = useState(false);
  const [providers, setProviders] = useState<any[]>([]);
  const [presets, setPresets] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const [selectedPresetId, setSelectedPresetId] = useState<string>('openai');
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editingKeyFor, setEditingKeyFor] = useState<string | null>(null);
  const [replacementKey, setReplacementKey] = useState('');
  const [updatingKey, setUpdatingKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});

  const load = () => {
    apiFetch<{ providers: any[] }>('/api/v1/models/providers').then((r) => setProviders(r.providers));
    apiFetch<{ presets: any[] }>('/api/v1/models/presets').then((r) => setPresets(r.presets));
    apiFetch<{ models: any[] }>('/api/v1/models').then((r) => setModels(r.models));
    apiFetch<{ settings: Record<string, any> }>('/api/v1/settings')
      .then((r) => setDefaultModelId(r.settings?.default_model_id ?? null))
      .catch(console.error);
    apiFetch<typeof chatgptPlan>('/api/v1/models/chatgpt-plan/status').then(setChatgptPlan).catch(() => {});
  };

  const handleChatGPTSignIn = async (accountId?: string) => {
    setChatgptWorking(true); setErrorMsg(null);
    try {
      await apiFetch('/api/v1/models/chatgpt-plan/sign-in', { method: 'POST', body: JSON.stringify(accountId ? { account_id: accountId } : {}) });
      setNoticeMsg('ChatGPT sign-in opened in your system browser. Complete consent there, then return to TJ.');
      load();
    } catch (e: any) { setErrorMsg(e.message || 'Could not start ChatGPT sign-in'); }
    finally { setChatgptWorking(false); }
  };

  const handleChatGPTDisconnect = async (accountId: string) => {
    setChatgptWorking(true); setErrorMsg(null);
    try {
      const result = await apiFetch<{ remote_revocation_confirmed: boolean }>('/api/v1/models/chatgpt-plan/disconnect', { method: 'POST', body: JSON.stringify({ account_id: accountId }) });
      setNoticeMsg(result.remote_revocation_confirmed ? 'ChatGPT account disconnected.' : 'Local ChatGPT credentials cleared. Remote revocation could not be confirmed; check ChatGPT Settings.');
      load();
    } catch (e: any) { setErrorMsg(e.message || 'Could not disconnect ChatGPT'); }
    finally { setChatgptWorking(false); }
  };

  const handleSetDefault = async (modelId: string) => {
    setSettingDefault(modelId);
    try {
      await apiFetch('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ default_model_id: modelId, routing_mode: 'manual' }),
      });
      setDefaultModelId(modelId);
    } catch (e: any) {
      console.error(e);
      setErrorMsg('Failed to set default model: ' + e.message);
    } finally {
      setSettingDefault(null);
    }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!chatgptPlan?.pending) return;
    const timer = window.setInterval(() => load(), 2500);
    return () => window.clearInterval(timer);
  }, [chatgptPlan?.pending]);

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await apiFetch<{ ok: boolean; detail: string }>(`/api/v1/models/providers/${id}/test`, { method: 'POST' });
      if (!result.ok) throw new Error(result.detail);
      setErrorMsg(null); setNoticeMsg(`Provider ${id} connection verified.`);
      load();
    } catch (e: any) {
      setErrorMsg(`Provider test failed: ${e.message}`);
    } finally {
      setTesting(null);
    }
  };

  const handleRefresh = async (id: string) => {
    try {
      const result = await apiFetch<{ models: unknown[] }>(`/api/v1/models/providers/${id}/refresh`, { method: 'POST' });
      setErrorMsg(null); setNoticeMsg(`${result.models.length} model(s) discovered for ${id}.`);
      load();
    } catch (e: any) {
      setErrorMsg(`Model discovery failed: ${e.message}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this provider?')) return;
    try {
      await apiFetch(`/api/v1/models/providers/${id}`, { method: 'DELETE' });
      load();
    } catch (e: any) {
      setErrorMsg(`Could not remove provider: ${e.message}`);
    }
  };

  const handleUpdateKey = async (id: string) => {
    if (!replacementKey.trim()) return;
    setUpdatingKey(true);
    setErrorMsg(null);
    try {
      await apiFetch(`/api/v1/models/providers/${id}`, {
        method: 'PATCH', body: JSON.stringify({ api_key: replacementKey.trim() }),
      });
      setReplacementKey('');
      setEditingKeyFor(null);
      setNoticeMsg('API key saved. Test the connection and discover models.');
      load();
    } catch (e: any) {
      setErrorMsg(`Could not save API key: ${e.message}`);
    } finally {
      setUpdatingKey(false);
    }
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      const preset = presets.find((p) => p.id === selectedPresetId);
      const isCustom = selectedPresetId === 'custom';
      const payload: any = {
        name: isCustom ? (customName.trim() || 'Custom Provider') : (preset?.name || selectedPresetId),
        kind: preset ? preset.kind : 'openai-compatible',
        ...(isCustom ? {} : { preset: selectedPresetId }),
        base_url: isCustom ? customBaseUrl.trim() : (preset?.base_url || null),
        api_key: apiKey.trim() || null,
      };
      await apiFetch('/api/v1/models/providers', { method: 'POST', body: JSON.stringify(payload) });
      setShowAddModal(false);
      setApiKey('');
      setCustomName('');
      setCustomBaseUrl('');
      setNoticeMsg('Provider saved. Test its connection and discover models before using it.');
      load();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to add provider');
    } finally {
      setSaving(false);
    }
  };

  const activePreset = presets.find((p) => p.id === selectedPresetId);
  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '0.04em', color: '#fff' }}>
            AI PROVIDERS & MODEL ROUTING
          </h2>
          <p style={{ color: 'var(--text-muted)', margin: '6px 0 0 0', fontSize: '0.85rem' }}>
            Multi-provider intelligence fabric: OpenAI, Anthropic, Gemini, Groq, DeepSeek, local Ollama, and self-hosted LLMs.
          </p>
        </div>

        <button
          onClick={() => { setShowAddModal(true); setErrorMsg(null); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 8,
            background: 'var(--accent-cyan)', color: '#000', fontWeight: 700, fontSize: '0.85rem',
            border: 'none', cursor: 'pointer', boxShadow: '0 0 15px rgba(0, 242, 254, 0.3)'
          }}
        >
          <Plus size={16} /> Add Provider
        </button>
      </div>
      {errorMsg && !showAddModal && <p role="alert" style={{ color: 'var(--accent-rose)', marginBottom: 12 }}>{errorMsg}</p>}
      {noticeMsg && <p role="status" style={{ color: 'var(--accent-emerald)', marginBottom: 12 }}>{noticeMsg}</p>}
      {chatgptPlan && <section style={{ background: 'rgba(10, 18, 34, 0.75)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 18, marginBottom: 24 }} aria-label="ChatGPT account connection">
        <div style={{ fontWeight: 800, color: '#fff', marginBottom: 6 }}>ChatGPT Account</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 12px' }}>
          Separate from the OpenAI API key provider. Eligible accounts can authorize supported text inference through their ChatGPT plan. Usage is subject to account and app limits.
        </p>
        {!chatgptPlan.enabled ? <p style={{ color: 'var(--accent-amber)', fontSize: '0.8rem' }}>
          Sign-in is disabled. This development feature requires an eligible open-source or approved private client and TJ_CHATGPT_PLAN_SIGNIN_ENABLED=1.
        </p> : <>
          <button type="button" disabled={chatgptWorking || chatgptPlan.pending} onClick={() => void handleChatGPTSignIn()}
            style={{ padding: '8px 12px', borderRadius: 6, background: 'var(--accent-cyan)', border: 0, color: '#000', fontWeight: 700, cursor: 'pointer' }}>
            {chatgptPlan.pending ? 'Waiting for browser sign-in...' : 'Continue with ChatGPT'}
          </button>
          {chatgptPlan.accounts.map((account) => <div key={account.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12, color: '#fff', fontSize: '0.8rem' }}>
            <span>{account.name || account.email || account.id} — {account.connected ? 'Connected' : 'Disconnected'}</span>
            <button type="button" disabled={chatgptWorking || chatgptPlan.pending} onClick={() => void handleChatGPTSignIn(account.id)} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--accent-cyan)', padding: '5px 8px', cursor: 'pointer' }}>Reconnect</button>
            <button type="button" disabled={chatgptWorking} onClick={() => void handleChatGPTDisconnect(account.id)} style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--accent-rose)', padding: '5px 8px', cursor: 'pointer' }}>Disconnect</button>
          </div>)}
          {chatgptPlan.last_error && <p role="alert" style={{ color: 'var(--accent-rose)', fontSize: '0.8rem' }}>{chatgptPlan.last_error}</p>}
        </>}
      </section>}
      <h3 style={{ fontSize: '0.95rem', fontFamily: 'JetBrains Mono', color: 'var(--accent-cyan)', marginBottom: 14 }}>
        CONFIGURED PROVIDERS ({providers.length})
      </h3>

      {providers.length === 0 ? (
        <div style={{
          background: 'rgba(10, 18, 34, 0.6)', border: '1px dashed rgba(0, 242, 254, 0.3)',
          borderRadius: 8, padding: 32, textAlign: 'center', marginBottom: 32
        }}>
          <Cpu size={36} color="var(--accent-cyan)" style={{ margin: '0 auto 12px', opacity: 0.8 }} />
          <div style={{ fontWeight: 600, color: '#fff', marginBottom: 6 }}>No Providers Added Yet</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 16 }}>
            Connect a cloud API key (OpenAI, Anthropic, Groq, DeepSeek, etc.) or local Ollama / LM Studio.
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            style={{
              padding: '8px 16px', borderRadius: 6, background: 'rgba(0, 242, 254, 0.15)',
              border: '1px solid var(--accent-cyan)', color: 'var(--accent-cyan)', fontWeight: 600,
              fontSize: '0.85rem', cursor: 'pointer'
            }}
          >
            Add Your First Provider
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16, marginBottom: 32 }}>
          {providers.map((p) => {
            const isHealthy = p.health === 'healthy';
            const providerModels = models.filter((m) => m.provider_id === p.id);
            const providerDefault = providerModels.find((m) => m.id === defaultModelId);
            const selectedModel = selectedModels[p.id] ?? providerDefault?.id ?? '';
            return (
              <div
                key={p.id}
                style={{
                  background: 'rgba(10, 18, 34, 0.75)', border: `1px solid ${isHealthy ? 'rgba(0, 242, 254, 0.3)' : 'var(--border-subtle)'}`,
                  borderRadius: 10, padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>{p.name}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono', marginTop: 2 }}>
                      {p.privacy_class.toUpperCase()} // {p.kind}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 700, fontFamily: 'JetBrains Mono',
                    padding: '3px 8px', borderRadius: 4,
                    background: isHealthy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                    color: isHealthy ? 'var(--accent-emerald)' : 'var(--accent-amber)',
                    border: `1px solid ${isHealthy ? 'var(--accent-emerald)' : 'var(--accent-amber)'}`
                  }}>
                    {p.health.toUpperCase()}
                  </span>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  URL: {p.base_url || 'Default SDK URL'}
                </div>

                {p.last_error && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-rose)', background: 'rgba(244, 63, 94, 0.1)', padding: '6px 8px', borderRadius: 4 }}>
                    {p.last_error}
                  </div>
                )}

                {p.kind === 'openai-compatible' && p.preset === null && (
                  editingKeyFor === p.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); void handleUpdateKey(p.id); }} style={{ display: 'flex', gap: 8 }}>
                      <input type="password" aria-label={`API key for ${p.name}`} autoComplete="new-password"
                        required value={replacementKey} onChange={(e) => setReplacementKey(e.target.value)}
                        placeholder="Enter API key" style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: '#fff' }} />
                      <button type="submit" disabled={updatingKey} style={{ borderRadius: 6, padding: '7px 10px', background: 'var(--accent-cyan)', border: 0, fontWeight: 700 }}>
                        {updatingKey ? 'Saving...' : 'Save Key'}
                      </button>
                      <button type="button" onClick={() => { setEditingKeyFor(null); setReplacementKey(''); }} style={{ borderRadius: 6, padding: '7px 10px', background: 'transparent', border: '1px solid var(--border-subtle)', color: '#fff' }}>Cancel</button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => { setEditingKeyFor(p.id); setReplacementKey(''); }}
                      style={{ alignSelf: 'flex-start', padding: 0, background: 'none', border: 0, color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: '0.75rem' }}>
                      {p.credential_ref ? 'Update API Key' : 'Add API Key'}
                    </button>
                  )
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 8, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <button
                    onClick={() => handleTest(p.id)} disabled={testing === p.id}
                    style={{
                      flex: 1, padding: '7px 10px', background: 'rgba(0, 242, 254, 0.1)', border: '1px solid var(--accent-cyan)',
                      borderRadius: 6, color: 'var(--accent-cyan)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    {testing === p.id ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button
                    onClick={() => handleRefresh(p.id)}
                    style={{
                      flex: 1, padding: '7px 10px', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid var(--border-subtle)',
                      borderRadius: 6, color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    Discover
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    title="Delete provider"
                    style={{
                      padding: '7px 10px', background: 'rgba(244, 63, 94, 0.1)', border: '1px solid rgba(244, 63, 94, 0.3)',
                      borderRadius: 6, color: 'var(--accent-rose)', cursor: 'pointer'
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <details style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: 10 }}>
                  <summary style={{ color: 'var(--accent-cyan)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>
                    Models ({providerModels.length}){providerDefault ? ` · Default: ${providerDefault.display_name || providerDefault.model}` : ''}
                  </summary>
                  {providerModels.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 0 }}>
                      No models found yet. Use Discover above after connecting this provider.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <select aria-label={`Choose model for ${p.name}`} value={selectedModel}
                        onChange={(e) => setSelectedModels((current) => ({ ...current, [p.id]: e.target.value }))}
                        style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 6, background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', color: '#fff' }}>
                        <option value="">Select a model</option>
                        {providerModels.map((m) => <option key={m.id} value={m.id}>{m.display_name || m.model}</option>)}
                      </select>
                      <button type="button" disabled={!selectedModel || settingDefault !== null || selectedModel === defaultModelId}
                        onClick={() => void handleSetDefault(selectedModel)}
                        style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--accent-cyan)', background: 'rgba(0, 242, 254, 0.1)', color: 'var(--accent-cyan)', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}>
                        {settingDefault === selectedModel ? 'Saving...' : selectedModel === defaultModelId ? 'Default' : 'Set Default'}
                      </button>
                    </div>
                  )}
                </details>
              </div>
            );
          })}
        </div>
      )}
      {showAddModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            width: '100%', maxWidth: 540, background: 'var(--bg-card)',
            border: '1px solid var(--accent-cyan)', borderRadius: 12, padding: 24,
            boxShadow: '0 0 30px rgba(0, 242, 254, 0.25)', display: 'flex', flexDirection: 'column', gap: 16
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Cpu size={20} color="var(--accent-cyan)" />
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>Connect AI Provider</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddProvider} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)', marginBottom: 6 }}>
                  SELECT PROVIDER PRESET
                </label>
                <select
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px', borderRadius: 6,
                    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                    color: '#fff', fontSize: '0.85rem'
                  }}
                >
                  <optgroup label="Cloud Providers">
                    {presets.filter((p) => p.privacy_class === 'cloud' && p.id !== 'custom').map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Local / Self-Hosted">
                    {presets.filter((p) => p.privacy_class === 'local').map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Custom">
                    <option value="custom">Custom OpenAI-Compatible Endpoint</option>
                  </optgroup>
                </select>
              </div>

              {selectedPresetId === 'custom' && (
                <>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)', marginBottom: 6 }}>
                      DISPLAY NAME
                    </label>
                    <input
                      type="text" required value={customName} onChange={(e) => setCustomName(e.target.value)}
                      placeholder="e.g. My Private vLLM Cluster"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 6,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        color: '#fff', fontSize: '0.85rem'
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)', marginBottom: 6 }}>
                      BASE URL
                    </label>
                    <input
                      type="url" required value={customBaseUrl} onChange={(e) => setCustomBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: 6,
                        background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                        color: '#fff', fontSize: '0.85rem'
                      }}
                    />
                  </div>
                </>
              )}

              {activePreset?.notes && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', background: 'rgba(255, 255, 255, 0.03)', padding: 10, borderRadius: 6 }}>
                  💡 {activePreset.notes}
                </div>
              )}

              {(selectedPresetId === 'custom' || activePreset?.requires_api_key !== false) && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <label style={{ fontSize: '0.75rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)' }}>
                      API KEY {activePreset?.requires_api_key ? '(REQUIRED)' : '(OPTIONAL)'}
                    </label>
                    {activePreset?.docs && (
                      <a
                        href={activePreset.docs} target="_blank" rel="noreferrer"
                        style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                      >
                        Get Key <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required={activePreset?.requires_api_key}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={activePreset?.env_key ? `sk-... or ${activePreset.env_key}` : 'Enter API Key...'}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 6,
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
                      color: '#fff', fontSize: '0.85rem'
                    }}
                  />
                </div>
              )}

              {errorMsg && (
                <div style={{ fontSize: '0.75rem', color: 'var(--accent-rose)', background: 'rgba(244, 63, 94, 0.1)', padding: 8, borderRadius: 6 }}>
                  {errorMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="button" onClick={() => setShowAddModal(false)}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 6,
                    background: 'transparent', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)', fontSize: '0.85rem', cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit" disabled={saving}
                  style={{
                    flex: 1, padding: '10px', borderRadius: 6,
                    background: 'var(--accent-cyan)', border: 'none',
                    color: '#000', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer'
                  }}
                >
                  {saving ? 'Saving...' : 'Save Provider'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
