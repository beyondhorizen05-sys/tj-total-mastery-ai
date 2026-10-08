import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type FishVoice = { id: string; name: string; languages: string[]; state: string };
type WindowsVoice = { name: string; gender: string; culture: string };

export const VoiceSelector: React.FC<{ value: string | null; onChange: (voice: string | null) => void; previewName: string }> = ({ value, onChange, previewName }) => {
  const [localVoices, setLocalVoices] = useState<WindowsVoice[]>([]);
  const [fishVoices, setFishVoices] = useState<FishVoice[]>([]);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadFish = async () => {
    setError('');
    try {
      const config = await apiFetch<{ configured: boolean }>('/api/v1/voice/fish/config');
      setConfigured(config.configured);
      if (config.configured) {
        const result = await apiFetch<{ voices: FishVoice[] }>('/api/v1/voice/fish/voices');
        setFishVoices(result.voices);
      } else setFishVoices([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load Fish Audio voices'); }
  };
  const loadWindows = async () => {
    try {
      const result = await apiFetch<{ voices: WindowsVoice[] }>('/api/v1/voice/windows/voices');
      setLocalVoices(result.voices);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load Windows voices'); }
  };

  useEffect(() => { void loadFish(); void loadWindows(); }, []);

  const preview = async () => {
    setError('');
    if (value?.startsWith('fish:')) {
      setBusy(true);
      try { await apiFetch('/api/v1/voice/fish/preview', { method: 'POST', body: JSON.stringify({ voice_id: value.slice(5), text: `Hello. I'm ${previewName}, and I'm ready when you are.` }) }); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Voice preview failed'); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/api/v1/voice/windows/preview', { method: 'POST', body: JSON.stringify({ voice_id: value || 'windows:default', text: `Hello. I'm ${previewName}, and I'm ready when you are.` }) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Windows voice preview failed'); }
    finally { setBusy(false); }
  };

  const missingSelectedFish = value?.startsWith('fish:') && !fishVoices.some((voice) => `fish:${voice.id}` === value);
  const missingSelectedWindows = value?.startsWith('windows:') && !['windows:default', 'windows:female', ...localVoices.map((voice) => `windows:${voice.name}`)].includes(value);
  const unsupportedSelected = !!value && !value.startsWith('fish:') && !value.startsWith('windows:');
  return <div style={{ marginTop: 17 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
      <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10, letterSpacing: '.09em', color: '#9bb8cb', textTransform: 'uppercase' }}>TJ voice
        <select value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} style={{ width: '100%', background: '#07192b', border: '1px solid rgba(130,188,221,.28)', borderRadius: 3, color: '#edf9ff', padding: '10px 11px', fontSize: 12 }}>
          <option value="">Windows system default</option>
          {fishVoices.length > 0 && <optgroup label="Your Fish Audio cloned voices">{fishVoices.map((voice) => <option key={voice.id} value={`fish:${voice.id}`}>{voice.name}{voice.languages.length ? ` · ${voice.languages.join(', ')}` : ''}</option>)}</optgroup>}
          {missingSelectedFish && <option value={value!}>Previously selected Fish voice · unavailable</option>}
          <optgroup label="Windows voices used by hands-free TJ"><option value="windows:female">Windows female voice</option>{localVoices.map((voice) => <option key={voice.name} value={`windows:${voice.name}`}>{voice.name} · {voice.gender} · {voice.culture}</option>)}</optgroup>
          {missingSelectedWindows && <option value={value!}>Previously selected Windows voice · unavailable</option>}
          {unsupportedSelected && <option value={value!}>Old browser-only voice · choose a working voice</option>}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => void preview()} style={{ padding: '10px 13px', background: 'rgba(65,166,213,.18)', border: '1px solid rgba(130,188,221,.35)', color: '#bceafd', cursor: 'pointer', borderRadius: 3, fontSize: 11 }}>{busy ? 'Playing…' : 'Preview'}</button>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, color: '#8baabd', fontSize: 11 }}><span>{configured ? `${fishVoices.length} Fish Audio voices loaded` : 'Fish Audio is not connected yet'} · {localVoices.length} Windows voices</span><button type="button" onClick={() => { void loadFish(); void loadWindows(); }} style={{ border: 0, background: 'transparent', color: '#7ddafa', cursor: 'pointer', fontSize: 11 }}>Refresh voices</button></div>
    {error && <p role="alert" style={{ color: '#ff9ca7', fontSize: 11 }}>{error}</p>}
  </div>;
};
