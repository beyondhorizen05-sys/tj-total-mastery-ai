import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles, Volume2 } from 'lucide-react';
import { DEFAULT_TJ_PERSONA, type TJPersona, type SystemStatus } from '@tj/schemas';
import { apiFetch } from '../api';
import { IdentityScene } from './IdentityScene';
import { VoiceSelector } from './VoiceSelector';
import './WelcomeExperience.css';

type ProviderChoice = 'later' | 'ollama' | 'openai' | 'anthropic' | 'openrouter';
type DeviceKind = 'microphone' | 'camera' | 'screen';
type SetupResponse = {
  profile: { display_name: string; locale: string; time_zone: string } | null;
  storage: { core_data_dir: string; project_files_dir: string };
  settings: Record<string, unknown>;
};
type Provider = { id: string; preset: string | null; kind: string; credential_ref: string | null; base_url: string | null; health: string };
type Model = { id: string; display_name: string; provider_id: string; available: boolean };
type Connector = {
  id: string; name: string; description: string; status: string; privacy: string;
  scopes: string[]; missing: string | null; configured_keys: string[];
  config_fields: Array<{ key: string; label: string; secret: boolean; required: boolean; placeholder?: string }>;
};

const STAGES = [
  'Welcome to TJ', 'Local profile', 'Privacy', 'Storage location', 'Model provider',
  'Local model discovery', 'Microphone permission', 'Camera permission', 'Screen access',
  'Connectors', 'Autonomy level', 'Spending limits', 'Notifications', 'Finish',
] as const;
const PROVIDERS: Array<{ id: ProviderChoice; label: string; kind?: string }> = [
  { id: 'later', label: 'Set up later' }, { id: 'ollama', label: 'Ollama · local', kind: 'ollama' },
  { id: 'openai', label: 'OpenAI', kind: 'openai' }, { id: 'anthropic', label: 'Anthropic', kind: 'anthropic' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible' },
];
const ARCHETYPES: Array<{ id: TJPersona['archetype']; detail: string }> = [
  { id: 'warm', detail: 'Calm and considerate' }, { id: 'executive', detail: 'Focused and decisive' },
  { id: 'mentor', detail: 'Patient and explanatory' }, { id: 'confident', detail: 'Direct and energetic' },
];
const localDate = Intl.DateTimeFormat().resolvedOptions();

export const WelcomeExperience: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [persona, setPersona] = useState<TJPersona>(DEFAULT_TJ_PERSONA);
  const [profile, setProfile] = useState({ display_name: '', locale: localDate.locale || 'en-US', time_zone: localDate.timeZone || 'UTC' });
  const [storage, setStorage] = useState({ core_data_dir: '', project_files_dir: '' });
  const [projectDir, setProjectDir] = useState('');
  const [privacy, setPrivacy] = useState<'balanced' | 'local-only'>('balanced');
  const [provider, setProvider] = useState<ProviderChoice>('later');
  const [apiKey, setApiKey] = useState('');
  const [providerUrl, setProviderUrl] = useState('http://127.0.0.1:11434');
  const [customProviderUrl, setCustomProviderUrl] = useState('');
  const [localUrl, setLocalUrl] = useState('http://127.0.0.1:11434');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connectorSearch, setConnectorSearch] = useState('');
  const [connectorDraft, setConnectorDraft] = useState<Record<string, Record<string, string>>>({});
  const [connectorResult, setConnectorResult] = useState<Record<string, { ok: boolean; detail: string }>>({});
  const [deviceResult, setDeviceResult] = useState<Record<DeviceKind, string>>({ microphone: '', camera: '', screen: '' });
  const [computerControl, setComputerControl] = useState(false);
  const [computerAvailable, setComputerAvailable] = useState(false);
  const [computerDetail, setComputerDetail] = useState('Checking local Windows bridge…');
  const [handsFree, setHandsFree] = useState(false);
  const [localAsrAvailable, setLocalAsrAvailable] = useState(false);
  const [autonomy, setAutonomy] = useState(2);
  const [dailyBudget, setDailyBudget] = useState('');
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [requestBudget, setRequestBudget] = useState('');
  const [notifications, setNotifications] = useState(true);
  const [browserNotifications, setBrowserNotifications] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [welcomeMessage, setWelcomeMessage] = useState("Welcome. I'm TJ. I'm so glad you're here. This is your space to think bigger, create freely, and make what matters to you real. Take a breath. The future is open, and we'll step into it together.");
  const [welcomeSpeaking, setWelcomeSpeaking] = useState(false);
  const [welcomeVoiceError, setWelcomeVoiceError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [setup, identity, system, providerData, modelData, connectorData, computer] = await Promise.all([
        apiFetch<SetupResponse>('/api/v1/system/setup'),
        apiFetch<{ persona: TJPersona }>('/api/v1/persona'),
        apiFetch<SystemStatus>('/api/v1/system/status'),
        apiFetch<{ providers: Provider[] }>('/api/v1/models/providers'),
        apiFetch<{ models: Model[] }>('/api/v1/models?active_only=true'),
        apiFetch<{ connectors: Connector[] }>('/api/v1/connectors'),
        apiFetch<{ available: boolean; bridge: { error?: string }; local_asr: { available: boolean } }>('/api/v1/computer/status'),
      ]);
      setPersona(identity.persona); setStatus(system);
      if (setup.profile) setProfile({ display_name: setup.profile.display_name, locale: setup.profile.locale, time_zone: setup.profile.time_zone });
      setStorage(setup.storage); setProjectDir(setup.storage.project_files_dir);
      setPrivacy(setup.settings.privacy_mode === 'local-only' ? 'local-only' : 'balanced');
      setComputerControl(setup.settings.computer_control_enabled === true);
      setComputerAvailable(computer.available);
      setComputerDetail(computer.available ? 'Local Windows bridge verified.' : computer.bridge.error || 'Windows bridge unavailable.');
      setLocalAsrAvailable(computer.local_asr?.available === true);
      setHandsFree(setup.settings.voice_autostart === true && setup.settings.voice_handsfree_mode === true);
      setAutonomy(typeof setup.settings.autonomy_level === 'number' ? setup.settings.autonomy_level : 2);
      setDailyBudget(setup.settings.budget_daily_usd == null ? '' : String(setup.settings.budget_daily_usd));
      setMonthlyBudget(setup.settings.budget_monthly_usd == null ? '' : String(setup.settings.budget_monthly_usd));
      setRequestBudget(setup.settings.max_request_cost_usd == null ? '' : String(setup.settings.max_request_cost_usd));
      setNotifications(setup.settings.notifications_enabled !== false);
      setSelectedModel(typeof setup.settings.default_model_id === 'string' ? setup.settings.default_model_id : '');
      const savedOllama = providerData.providers.find((item) => item.preset === 'ollama');
      if (savedOllama?.base_url) { setProviderUrl(savedOllama.base_url); setLocalUrl(savedOllama.base_url); }
      setProviders(providerData.providers); setModels(modelData.models.filter((model) => model.available)); setConnectors(connectorData.connectors);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load setup'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (loading || step !== 0) return;
    let cancelled = false;
    const locale = profile.locale || navigator.language || 'en-US';
    void apiFetch<{ text: string; played: boolean }>(`/api/v1/voice/welcome?locale=${encodeURIComponent(locale)}`)
      .then(async (welcome) => {
        if (cancelled) return;
        setWelcomeMessage(welcome.text);
        if (welcome.played) return;
        setWelcomeSpeaking(true);
        try {
          await apiFetch('/api/v1/voice/welcome', { method: 'POST', body: JSON.stringify({ locale }) });
        } catch (reason) {
          if (!cancelled) setWelcomeVoiceError(reason instanceof Error ? reason.message : 'Could not play the welcome.');
        } finally { if (!cancelled) setWelcomeSpeaking(false); }
      })
      .catch(() => { if (!cancelled) setWelcomeVoiceError('Voice service is unavailable. Try Replay welcome.'); });
    return () => { cancelled = true; };
  }, [loading, step, profile.locale]);
  useEffect(() => {
    if (step !== 8) return;
    void apiFetch<SetupResponse>('/api/v1/system/setup').then((current) => setComputerControl(current.settings.computer_control_enabled === true)).catch(() => {});
  }, [step]);

  const updatePersona = <K extends keyof TJPersona>(key: K, value: TJPersona[K]) => setPersona((current) => ({ ...current, [key]: value }));
  const saveSettings = async (patch: Record<string, unknown>) => { await apiFetch('/api/v1/settings', { method: 'PATCH', body: JSON.stringify(patch) }); };
  const refreshModels = async () => {
    const result = await apiFetch<{ models: Model[] }>('/api/v1/models?active_only=true');
    setModels(result.models.filter((model) => model.available));
    return result.models;
  };
  const refreshConnectors = async () => {
    const result = await apiFetch<{ connectors: Connector[] }>('/api/v1/connectors');
    setConnectors(result.connectors);
  };

  const connectProvider = async (choice: ProviderChoice, baseUrl?: string) => {
    if (choice === 'later') return;
    const existing = providers.find((item) => item.preset === choice);
    if (!existing && choice !== 'ollama' && !apiKey.trim()) throw new Error(`Enter a ${choice} API key, or select Set up later.`);
    const kind = PROVIDERS.find((item) => item.id === choice)?.kind;
    if (!kind) throw new Error('Unsupported provider');
    const endpoint = choice === 'ollama' ? baseUrl?.trim() : customProviderUrl.trim();
    let configured = existing ?? await apiFetch<Provider>('/api/v1/models/providers', {
      method: 'POST', body: JSON.stringify({
        name: PROVIDERS.find((item) => item.id === choice)?.label, kind, preset: choice,
        ...(endpoint ? { base_url: endpoint } : {}),
        ...(choice !== 'ollama' ? { api_key: apiKey.trim() } : {}),
      }),
    });
    if (existing) {
      const patch = {
        ...(choice !== 'ollama' && apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        ...(endpoint && endpoint !== existing.base_url ? { base_url: endpoint } : {}),
      };
      if (Object.keys(patch).length) configured = await apiFetch<Provider>(`/api/v1/models/providers/${configured.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    }
    // A failed test still leaves the provider saved. Keep its ID so retry updates it instead of creating a duplicate.
    setProviders((current) => [...current.filter((item) => item.id !== configured.id), configured]);
    const tested = await apiFetch<{ ok: boolean; detail: string }>(`/api/v1/models/providers/${configured.id}/test`, { method: 'POST' });
    if (!tested.ok) throw new Error(`${choice}: ${tested.detail}`);
    const discovered = await apiFetch<{ models: Model[] }>(`/api/v1/models/providers/${configured.id}/refresh`, { method: 'POST' });
    if (discovered.models.length === 0) throw new Error(`${choice} connected but returned no models. Start or enable a model before continuing.`);
    const all = await refreshModels();
    if (!selectedModel && all.length) setSelectedModel(all.find((model) => model.provider_id === configured.id)?.id ?? all[0].id);
    setApiKey('');
    setNotice(`${choice} verified; ${discovered.models.length} models discovered.`);
  };

  const next = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      if (step === 1) {
        await apiFetch('/api/v1/system/profile', { method: 'PUT', body: JSON.stringify(profile) });
        await apiFetch('/api/v1/persona', { method: 'PUT', body: JSON.stringify(persona) });
      } else if (step === 2) {
        await saveSettings({ privacy_mode: privacy });
      } else if (step === 3 && projectDir.trim() !== storage.project_files_dir) {
        const result = await apiFetch<{ project_files_dir: string; core_data_dir: string }>('/api/v1/system/project-storage', { method: 'PUT', body: JSON.stringify({ directory: projectDir.trim() }) });
        setStorage(result); setProjectDir(result.project_files_dir);
      } else if (step === 4 && provider !== 'later') {
        await connectProvider(provider, provider === 'ollama' ? providerUrl.trim() : undefined);
      } else if (step === 5) {
        await saveSettings({ default_model_id: selectedModel || null });
      } else if (step === 6) {
        if (handsFree) {
          if (!localAsrAvailable) throw new Error('The local multilingual speech model is unavailable. Install it before enabling hands-free listening.');
          await saveSettings({ voice_handsfree_mode: true, voice_asr_provider: 'local' });
          await apiFetch('/api/v1/voice/start', { method: 'POST' });
          setNotice('Windows microphone is listening. TJ will listen again when the API starts.');
        } else {
          await apiFetch('/api/v1/voice/stop', { method: 'POST' });
          await saveSettings({ voice_handsfree_mode: false });
        }
      } else if (step === 8) {
        if (computerControl && !computerAvailable) throw new Error('Local computer bridge is unavailable. Leave this off or fix the bridge before continuing.');
        await saveSettings({ computer_control_enabled: computerControl });
      } else if (step === 10) {
        await saveSettings({ autonomy_level: autonomy });
      } else if (step === 11) {
        const parseBudget = (value: string) => value.trim() === '' ? null : Number(value);
        const values = [dailyBudget, monthlyBudget, requestBudget].map(parseBudget);
        if (values.some((value) => value != null && (!Number.isFinite(value) || value < 0))) throw new Error('Enter non-negative dollar amounts or leave limits blank.');
        await saveSettings({ budget_daily_usd: values[0], budget_monthly_usd: values[1], max_request_cost_usd: values[2] });
      } else if (step === 12) {
        await saveSettings({ notifications_enabled: notifications });
      } else if (step === 13) {
        await apiFetch('/api/v1/system/first-run', { method: 'POST', body: JSON.stringify({ completed: true }) });
        onComplete(); return;
      }
      setStep((current) => Math.min(current + 1, STAGES.length - 1));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Setup could not be saved'); }
    finally { setSaving(false); }
  };

  const testDevice = async (kind: DeviceKind) => {
    setError(''); setNotice('');
    try {
      if (!navigator.mediaDevices) throw new Error('Media permissions are unavailable in this browser.');
      const stream = kind === 'screen'
        ? await navigator.mediaDevices.getDisplayMedia({ video: true })
        : await navigator.mediaDevices.getUserMedia(kind === 'microphone' ? { audio: true } : { video: true });
      stream.getTracks().forEach((track) => track.stop());
      setDeviceResult((current) => ({ ...current, [kind]: 'Permission verified in this browser session. The browser may ask again later.' }));
    } catch (reason) {
      setDeviceResult((current) => ({ ...current, [kind]: reason instanceof Error ? reason.message : 'Permission was not granted.' }));
    }
  };

  const saveConnector = async (connector: Connector) => {
    setSaving(true); setError('');
    try {
      const values = Object.fromEntries(Object.entries(connectorDraft[connector.id] ?? {}).filter(([, value]) => value.trim() !== ''));
      if (Object.keys(values).length) await apiFetch(`/api/v1/connectors/${connector.id}/config`, { method: 'PUT', body: JSON.stringify(values) });
      const tested = await apiFetch<{ ok: boolean; detail: string }>(`/api/v1/connectors/${connector.id}/test`, { method: 'POST' });
      setConnectorResult((current) => ({ ...current, [connector.id]: { ok: tested.ok, detail: tested.detail } }));
      if (tested.ok) setConnectorDraft((current) => ({ ...current, [connector.id]: {} }));
      await refreshConnectors();
    } catch (reason) { setConnectorResult((current) => ({ ...current, [connector.id]: { ok: false, detail: reason instanceof Error ? reason.message : 'Connector failed' } })); }
    finally { setSaving(false); }
  };

  const disconnectConnector = async (connector: Connector) => {
    if (!window.confirm(`Remove TJ's saved ${connector.name} configuration?`)) return;
    setSaving(true); setError('');
    try {
      const cleared = Object.fromEntries(connector.configured_keys.map((key) => [key, '']));
      await apiFetch(`/api/v1/connectors/${connector.id}/config`, { method: 'PUT', body: JSON.stringify(cleared) });
      setConnectorDraft((current) => ({ ...current, [connector.id]: {} }));
      setConnectorResult((current) => ({ ...current, [connector.id]: { ok: true, detail: 'Saved configuration removed.' } }));
      await refreshConnectors();
    } catch (reason) {
      setConnectorResult((current) => ({ ...current, [connector.id]: { ok: false, detail: reason instanceof Error ? reason.message : 'Could not disconnect.' } }));
    } finally { setSaving(false); }
  };

  const requestBrowserNotifications = async () => {
    if (typeof Notification === 'undefined') { setBrowserNotifications('unsupported'); return; }
    const permission = await Notification.requestPermission();
    setBrowserNotifications(permission);
    if (permission !== 'granted') setNotice('In-app alerts can still appear; browser notifications were not granted.');
  };

  const replayWelcome = async () => {
    setWelcomeSpeaking(true); setWelcomeVoiceError('');
    try {
      await apiFetch('/api/v1/voice/welcome', { method: 'POST', body: JSON.stringify({ locale: profile.locale || navigator.language || 'en-US', replay: true }) });
    } catch (reason) { setWelcomeVoiceError(reason instanceof Error ? reason.message : 'Could not play the welcome.'); }
    finally { setWelcomeSpeaking(false); }
  };

  const choose = (selected: boolean) => selected ? 'tj-setup-choice selected' : 'tj-setup-choice';
  const budgetInput = (label: string, value: string, setValue: (value: string) => void) => <label className="tj-setup-field">{label}<input type="number" min="0" step="0.01" value={value} placeholder="No limit" onChange={(event) => setValue(event.target.value)} /></label>;
  const deviceStep = (kind: DeviceKind, title: string, detail: string) => <div className="tj-welcome-copy"><span className="tj-eyebrow">OPTIONAL PERMISSION</span><h1>{title}</h1><p>{detail}</p><button className="tj-setup-action" onClick={() => void testDevice(kind)}>Request and test {kind} access</button><p className="tj-setup-result" role="status">{deviceResult[kind] || 'Nothing is requested until you press the button. You can continue without granting access.'}</p></div>;

  return <main className={`tj-welcome step-${step}`}>
    <div className="tj-welcome-stars" /><div className="tj-welcome-gate" />
    <header className="tj-welcome-top"><div className="tj-brand"><span className="tj-brand-mark">T<span>J</span></span><span className="tj-brand-words">TOTAL MASTERY <b>AI</b></span></div><span className="tj-welcome-overline">PERSONAL INTELLIGENCE SYSTEM <i /> INITIALIZATION</span></header>
    <div className="tj-welcome-layout">
      <section className="tj-welcome-stage"><div className="tj-welcome-orbit orbit-one" /><div className="tj-welcome-orbit orbit-two" /><IdentityScene className="tj-welcome-scene" embodiment={persona.embodiment} state={status?.tj_state ?? 'idle'} /><div className="tj-welcome-form-label">{persona.embodiment.toUpperCase()} / {status?.tj_state?.toUpperCase() ?? 'INITIALIZING'}</div></section>
      <section className="tj-welcome-content">
        <div className="tj-setup-progress"><span>SETUP {String(step + 1).padStart(2, '0')} / 14</span><strong>{STAGES[step]}</strong><div className="tj-setup-track"><i style={{ width: `${((step + 1) / STAGES.length) * 100}%` }} /></div></div>
        {loading ? <p className="tj-setup-result">Loading your local setup…</p> : <>
          {step === 0 && <div className="tj-welcome-copy"><span className="tj-eyebrow"><Sparkles size={14} /> A NEW KIND OF BEGINNING</span><h1>Open the door<br />to <em>what's next.</em></h1><p>Build a personal intelligence environment around your preferences. Fourteen short stages connect each choice to a real local setting or service; optional access can be skipped.</p><div className={welcomeSpeaking ? 'tj-welcome-greeting speaking' : 'tj-welcome-greeting'}><div className="tj-welcome-greeting-head"><span><Volume2 size={16} /> TJ, HERE WITH YOU</span><button type="button" disabled={welcomeSpeaking} onClick={() => void replayWelcome()}>{welcomeSpeaking ? 'Speaking…' : 'Replay welcome'}</button></div><p>“{welcomeMessage}”</p>{welcomeVoiceError && <small role="alert">{welcomeVoiceError}</small>}</div><div className="tj-welcome-health"><span className={status ? 'online' : ''} /> {status ? `System connected · ${status.tj_state}` : 'Connecting to your local system…'}</div><div className="tj-choice-grid">{(['core', 'female', 'male'] as const).map((form) => <button key={form} className={persona.embodiment === form ? 'tj-choice selected' : 'tj-choice'} onClick={() => updatePersona('embodiment', form)}><span>{form}</span><small>{form === 'core' ? 'Pure intelligence' : 'Human presence'}</small>{persona.embodiment === form && <Check size={16} />}</button>)}</div></div>}
          {step === 1 && <div className="tj-welcome-copy"><span className="tj-eyebrow">LOCAL PROFILE</span><h1>Make it<br /><em>yours.</em></h1><p>Your profile stays in TJ's local database. Appearance and personality are applied across the workspace.</p><div className="tj-form-row"><label>Your name<input value={profile.display_name} maxLength={80} onChange={(event) => setProfile({ ...profile, display_name: event.target.value })} /></label><label>Assistant name<input value={persona.name} maxLength={32} onChange={(event) => updatePersona('name', event.target.value)} /></label></div><div className="tj-form-row"><label>Locale<input value={profile.locale} onChange={(event) => setProfile({ ...profile, locale: event.target.value })} /></label><label>Time zone<input value={profile.time_zone} onChange={(event) => setProfile({ ...profile, time_zone: event.target.value })} /></label></div><div className="tj-archetypes">{ARCHETYPES.map((item) => <button key={item.id} className={persona.archetype === item.id ? 'tj-archetype selected' : 'tj-archetype'} onClick={() => updatePersona('archetype', item.id)}><b>{item.id}</b><small>{item.detail}</small></button>)}</div><div className="tj-form-row"><label>Communication<select value={persona.communication} onChange={(event) => updatePersona('communication', event.target.value as TJPersona['communication'])}><option value="concise">Concise</option><option value="balanced">Balanced</option><option value="detailed">Detailed</option></select></label><label>Relationship<select value={persona.relationship} onChange={(event) => updatePersona('relationship', event.target.value as TJPersona['relationship'])}><option value="friendly">Friendly</option><option value="professional">Professional</option><option value="coach">Coach</option><option value="girlfriend">Girlfriend · affectionate</option><option value="boyfriend">Boyfriend · affectionate</option></select></label></div><VoiceSelector value={persona.voice_id} onChange={(voice) => updatePersona('voice_id', voice)} previewName={persona.name} /></div>}
          {step === 2 && <div className="tj-welcome-copy"><span className="tj-eyebrow">PRIVACY</span><h1>Choose your<br /><em>boundary.</em></h1><p>Local-only blocks cloud models, outbound network tools and connectors. Balanced allows connected providers under TJ permissions.</p><div className="tj-setup-options"><button className={choose(privacy === 'local-only')} onClick={() => setPrivacy('local-only')}><b>Local-only</b><small>Keep model/tool traffic on this machine.</small></button><button className={choose(privacy === 'balanced')} onClick={() => setPrivacy('balanced')}><b>Balanced</b><small>Allow configured cloud providers and approved connectors.</small></button></div></div>}
          {step === 3 && <div className="tj-welcome-copy"><span className="tj-eyebrow">STORAGE LOCATION</span><h1>Your files.<br /><em>Your place.</em></h1><p>Choose where new TJ project files are created. Existing projects remain in their current folders; the local database and encrypted vault stay in the core data directory shown below.</p><label className="tj-setup-field">New project files folder<input value={projectDir} onChange={(event) => setProjectDir(event.target.value)} /></label><p className="tj-setup-result">Core database and vault: {storage.core_data_dir || 'Loading…'}</p></div>}
          {step === 4 && <div className="tj-welcome-copy"><span className="tj-eyebrow">MODEL PROVIDER</span><h1>Choose TJ's<br /><em>intelligence.</em></h1><p>Connection is tested and models are discovered before TJ marks it ready. You can set up a provider later.</p><div className="tj-setup-options compact">{PROVIDERS.map((item) => <button key={item.id} className={choose(provider === item.id)} onClick={() => { setProvider(item.id); setApiKey(''); setCustomProviderUrl(''); }}><b>{item.label}</b><small>{providers.some((current) => current.preset === item.id) ? 'Already configured; test again' : item.id === 'later' ? 'Chat will wait for a provider' : 'Test and discover models'}</small></button>)}</div>{provider !== 'later' && provider !== 'ollama' && <><label className="tj-setup-field">API key<input type="password" autoComplete="off" value={apiKey} placeholder={providers.some((item) => item.preset === provider) ? 'Leave blank to reuse saved key' : 'Paste API key'} onChange={(event) => setApiKey(event.target.value)} /></label><label className="tj-setup-field">Custom Base URL · optional<input type="url" value={customProviderUrl} placeholder={providers.find((item) => item.preset === provider)?.base_url ?? 'Leave blank for the official provider endpoint'} onChange={(event) => setCustomProviderUrl(event.target.value)} /></label><p className="tj-setup-result">{customProviderUrl.trim() ? 'Your API key will be sent to this endpoint during the connection test. Use a service you trust.' : `Current endpoint: ${providers.find((item) => item.preset === provider)?.base_url ?? 'official provider endpoint'}`}</p></>}{provider === 'ollama' && <label className="tj-setup-field">Ollama URL<input type="url" value={providerUrl} onChange={(event) => setProviderUrl(event.target.value)} /></label>}</div>}
          {step === 5 && <div className="tj-welcome-copy"><span className="tj-eyebrow">LOCAL MODEL DISCOVERY</span><h1>Find a model<br /><em>near you.</em></h1><p>Optionally connect Ollama running on this computer. Discovery reads its real model list. Choose a default from models already found.</p><label className="tj-setup-field">Local Ollama URL<input value={localUrl} onChange={(event) => setLocalUrl(event.target.value)} /></label><button className="tj-setup-action" disabled={saving} onClick={() => { setSaving(true); setError(''); void connectProvider('ollama', localUrl.trim()).catch((reason) => setError(reason.message)).finally(() => setSaving(false)); }}>Test and discover local models</button><label className="tj-setup-field">Default model<select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}><option value="">Automatic routing / choose later</option>{models.map((model) => <option key={model.id} value={model.id}>{model.display_name || model.id}</option>)}</select></label><p className="tj-setup-result">{models.length} available model records. Discovery alone does not prove inference; TJ will report actual call failures.</p></div>}
          {step === 6 && <>{deviceStep('microphone', 'Let TJ hear you.', 'The browser permission test is optional and stops its track immediately. TJ hands-free listening uses the Windows microphone and local multilingual speech recognition.')}<div className="tj-setup-inline"><label><input type="checkbox" checked={handsFree} disabled={!localAsrAvailable} onChange={(event) => setHandsFree(event.target.checked)} /> Start Windows hands-free listening and remember this choice</label><small>{localAsrAvailable ? 'The local speech model is installed. This starts the actual TJ listener when you continue.' : 'The local speech model is unavailable on this host. You can still continue without hands-free listening.'}</small></div></>}
          {step === 7 && deviceStep('camera', 'Give TJ sight.', 'Optional camera access for future visual tasks. The camera stream is stopped immediately after this permission test.')}
          {step === 8 && <>{deviceStep('screen', 'Share your screen.', 'Choose a screen or window to test browser screen capture. Browser sharing is not Windows input control; it must be requested again when used.')}<div className="tj-setup-inline"><label><input type="checkbox" checked={computerControl} disabled={!computerAvailable} onChange={(event) => setComputerControl(event.target.checked)} /> Enable local Windows computer tools for TJ agents</label><small>{computerDetail} TJ still checks action permissions and approvals. With hands-free listening enabled, say “TJ” and your command.</small></div></>}
          {step === 9 && <div className="tj-welcome-copy"><span className="tj-eyebrow">CONNECTORS</span><h1>Connect your<br /><em>world.</em></h1><p>Each connector shows its data scope and privacy path. Keys are stored in TJ's encrypted vault. This stage is optional.</p><label className="tj-setup-field">Find connector<input value={connectorSearch} onChange={(event) => setConnectorSearch(event.target.value)} placeholder="Search by name or purpose" /></label><div className="tj-setup-connectors">{connectors.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(connectorSearch.toLowerCase())).map((item) => <div key={item.id} className="tj-setup-connector"><b>{item.name} <small>{item.status}</small></b><p>{item.description}</p><small>Scopes: {item.scopes.join(', ') || 'None'} · {item.privacy}</small>{item.config_fields.map((field) => <label key={field.key} className="tj-setup-field">{field.label}{field.required ? ' *' : ''}<input type={field.secret ? 'password' : 'text'} autoComplete="off" value={connectorDraft[item.id]?.[field.key] ?? ''} placeholder={item.configured_keys.includes(field.key) ? 'Saved · leave blank to keep' : field.placeholder ?? ''} onChange={(event) => setConnectorDraft((current) => ({ ...current, [item.id]: { ...current[item.id], [field.key]: event.target.value } }))} /></label>)}<button className="tj-setup-action" disabled={saving} onClick={() => void saveConnector(item)}>Save and test connection</button>{item.configured_keys.length > 0 && <button className="tj-setup-action tj-setup-disconnect" disabled={saving} onClick={() => void disconnectConnector(item)}>Disconnect</button>}{connectorResult[item.id] && <p role={connectorResult[item.id].ok ? 'status' : 'alert'} className={connectorResult[item.id].ok ? 'tj-setup-result' : 'tj-welcome-error'}>{connectorResult[item.id].ok ? (connectorResult[item.id].detail === 'Saved configuration removed.' ? 'Disconnected: ' : 'Connected: ') : 'Connection failed: '}{connectorResult[item.id].detail}</p>}</div>)}</div></div>}
          {step === 10 && <div className="tj-welcome-copy"><span className="tj-eyebrow">AUTONOMY</span><h1>You set the<br /><em>limits.</em></h1><p>Choose how far TJ may act without pausing. High-risk actions still require explicit approval.</p><div className="tj-setup-options">{[{ level: 1, title: 'Read-only', detail: 'Answers and inspection.' }, { level: 2, title: 'Draft', detail: 'Plans and sandboxed drafts.' }, { level: 3, title: 'Supervised', detail: 'Low-risk actions automatically.' }, { level: 4, title: 'Workflow', detail: 'Pre-authorized medium-risk work.' }].map((item) => <button key={item.level} className={choose(autonomy === item.level)} onClick={() => setAutonomy(item.level)}><b>{item.title}</b><small>{item.detail}</small></button>)}</div></div>}
          {step === 11 && <div className="tj-welcome-copy"><span className="tj-eyebrow">SPENDING LIMITS</span><h1>Budget with<br /><em>confidence.</em></h1><p>Optional estimated USD guards check known model prices before a call. A model with unknown pricing is blocked while limits are active. Provider prices and charges can change, so check your provider dashboard for the final bill.</p><div className="tj-setup-budgets">{budgetInput('Daily estimate cap · USD', dailyBudget, setDailyBudget)}{budgetInput('Monthly estimate cap · USD', monthlyBudget, setMonthlyBudget)}{budgetInput('Per-request estimate cap · USD', requestBudget, setRequestBudget)}</div></div>}
          {step === 12 && <div className="tj-welcome-copy"><span className="tj-eyebrow">NOTIFICATIONS</span><h1>Stay in<br /><em>the loop.</em></h1><p>TJ can surface approvals and failed work in the app. Browser desktop alerts need a separate browser permission.</p><label className="tj-setup-toggle"><input type="checkbox" checked={notifications} onChange={(event) => setNotifications(event.target.checked)} /> Show TJ event alerts</label><button className="tj-setup-action" onClick={() => void requestBrowserNotifications()}>Request browser notification permission</button><p className="tj-setup-result">Browser permission: {browserNotifications}</p></div>}
          {step === 13 && <div className="tj-welcome-copy"><span className="tj-eyebrow">FINISH</span><h1>You're at<br /><em>the threshold.</em></h1><p>These choices have been saved as you progressed. Finish marks first-run setup complete; you can change them later in Settings.</p><div className="tj-setup-review"><div>Profile <b>{profile.display_name}</b></div><div>Presence <b>{persona.embodiment} · {persona.archetype}</b></div><div>Privacy <b>{privacy}</b></div><div>Projects <b>{projectDir}</b></div><div>Model <b>{selectedModel || 'automatic / later'}</b></div><div>Computer control <b>{computerControl ? 'enabled locally' : 'off'}</b></div><div>Autonomy <b>Level {autonomy}</b></div><div>Notifications <b>{notifications ? 'on' : 'off'}</b></div></div></div>}
        </>}
        {error && <div className="tj-welcome-error" role="alert">{error}</div>}
        {notice && <div className="tj-setup-result" role="status">{notice}</div>}
        <footer className="tj-welcome-actions"><button className="tj-back" disabled={step === 0 || saving} onClick={() => { setError(''); setNotice(''); setStep((current) => Math.max(0, current - 1)); }}><ArrowLeft size={17} /> Back</button><button className="tj-next" disabled={loading || saving || (step === 1 && (!profile.display_name.trim() || !persona.name.trim())) || (step === 3 && !projectDir.trim())} onClick={() => void next()}>{saving ? 'Saving…' : step === 13 ? 'Enter your world' : step === 0 ? 'Begin the journey' : 'Save & continue'} <ArrowRight size={17} /></button></footer>
      </section>
    </div>
    <div className="tj-welcome-bottom"><span>YOUR WORLD. YOUR INTELLIGENCE.</span><span>EST. 2026 / TJ</span></div>
  </main>;
};
