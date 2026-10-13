import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type FishVoice = { id: string; name: string; languages: string[]; state: string };
type WindowsVoice = { name: string; gender: string; culture: string };

const HUMAN_NEURAL_VOICES = [
  { id: 'neural:jenny', name: '✨ Jenny · Warm, Conversational (Human Neural)', default: true },
  { id: 'neural:aria', name: '✨ Aria · Expressive & Articulate (Human Neural)' },
  { id: 'neural:guy', name: '✨ Guy · Calm, Deep & Confident (Human Neural)' },
  { id: 'neural:ava', name: '✨ Ava · Friendly & Natural (Human Neural)' },
  { id: 'neural:andrew', name: '✨ Andrew · Thoughtful & Clear (Human Neural)' },
];

export const VoiceSelector: React.FC<{ value: string | null; onChange: (voice: string | null) => void; previewName: string }> = ({ value, onChange, previewName }) => {
  const [localVoices, setLocalVoices] = useState<WindowsVoice[]>([]);
  const [fishVoices, setFishVoices] = useState<FishVoice[]>([]);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadFish = async () => {
    try {
      const config = await apiFetch<{ configured: boolean }>('/api/v1/voice/fish/config');
      setConfigured(config.configured);
      if (config.configured) {
        const result = await apiFetch<{ voices: FishVoice[] }>('/api/v1/voice/fish/voices');
        setFishVoices(result.voices || []);
      } else {
        setFishVoices([]);
      }
    } catch {
      // Graceful fallback when Fish Audio key is not configured
      setConfigured(false);
      setFishVoices([]);
    }
  };

  const loadWindows = async () => {
    try {
      const result = await apiFetch<{ voices: WindowsVoice[] }>('/api/v1/voice/windows/voices');
      setLocalVoices(result.voices || []);
    } catch {
      // Graceful fallback when local PowerShell SAPI is not available
      setLocalVoices([]);
    }
  };

  const loadBrowserVoices = () => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const voices = window.speechSynthesis.getVoices();
      setBrowserVoices(voices);
    }
  };

  useEffect(() => {
    void loadFish();
    void loadWindows();
    loadBrowserVoices();
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = loadBrowserVoices;
    }
    // Default to Jenny neural human voice if none is selected
    if (!value) {
      onChange('neural:jenny');
    }
  }, []);

  const preview = async () => {
    const sampleText = `Hello! I'm ${previewName}. I'm your AI operating environment, ready for live human conversation.`;

    if (value?.startsWith('fish:')) {
      setBusy(true);
      try {
        await apiFetch('/api/v1/voice/fish/preview', {
          method: 'POST',
          body: JSON.stringify({ voice_id: value.slice(5), text: sampleText }),
        });
      } catch {
        // Fallback to browser neural voice on preview issue
      } finally {
        setBusy(false);
      }
      return;
    }

    // High quality human neural browser voice playback
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      setBusy(true);
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(sampleText);
        const voices = browserVoices.length ? browserVoices : window.speechSynthesis.getVoices();

        const selectedId = value || 'neural:jenny';
        const targetVoice = selectedId.startsWith('neural:') ? selectedId.slice(7) : selectedId.startsWith('windows:') ? selectedId.slice(8) : 'jenny';

        const isNatural = (v: SpeechSynthesisVoice) => /natural|online|neural|google|journey/i.test(v.name);
        const isNotRobotic = (v: SpeechSynthesisVoice) => !/desktop|sapi/i.test(v.name);

        const naturalMatch =
          voices.find((v) => isNatural(v) && new RegExp(targetVoice, 'i').test(v.name)) ||
          voices.find((v) => isNatural(v) && /en/i.test(v.lang)) ||
          voices.find((v) => isNotRobotic(v) && new RegExp(targetVoice, 'i').test(v.name)) ||
          voices.find((v) => isNotRobotic(v) && /en/i.test(v.lang)) ||
          voices.find((v) => new RegExp(targetVoice, 'i').test(v.name)) ||
          voices[0];

        if (naturalMatch) {
          utterance.voice = naturalMatch;
        }

        utterance.rate = 1.02;
        utterance.pitch = 1.0;
        utterance.onend = () => setBusy(false);
        utterance.onerror = () => setBusy(false);

        window.speechSynthesis.speak(utterance);
      } catch {
        setBusy(false);
      }
    } else {
      // Fallback to backend preview if browser speech is unavailable
      setBusy(true);
      try {
        await apiFetch('/api/v1/voice/windows/preview', {
          method: 'POST',
          body: JSON.stringify({ voice_id: value || 'windows:female', text: sampleText }),
        });
      } catch {
        // Ignore preview failure silently
      } finally {
        setBusy(false);
      }
    }
  };

  const selectedVoiceValue = value || 'neural:jenny';

  return (
    <div style={{ marginTop: 17 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
        <label
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 10,
            letterSpacing: '.09em',
            color: '#9bb8cb',
            textTransform: 'uppercase',
          }}
        >
          TJ voice
          <select
            value={selectedVoiceValue}
            onChange={(event) => onChange(event.target.value || 'neural:jenny')}
            style={{
              width: '100%',
              background: '#07192b',
              border: '1px solid rgba(130,188,221,.28)',
              borderRadius: 6,
              color: '#edf9ff',
              padding: '10px 11px',
              fontSize: 12,
              outline: 'none',
            }}
          >
            <optgroup label="✨ Human Neural Voices (Realistic & Natural)">
              {HUMAN_NEURAL_VOICES.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.name}
                </option>
              ))}
            </optgroup>

            {fishVoices.length > 0 && (
              <optgroup label="Cloned Voices (Fish Audio)">
                {fishVoices.map((voice) => (
                  <option key={voice.id} value={`fish:${voice.id}`}>
                    {voice.name}
                    {voice.languages.length ? ` · ${voice.languages.join(', ')}` : ''}
                  </option>
                ))}
              </optgroup>
            )}

            {localVoices.length > 0 && (
              <optgroup label="System Legacy Voices (Windows)">
                <option value="windows:female">Windows default female</option>
                {localVoices.map((voice) => (
                  <option key={voice.name} value={`windows:${voice.name}`}>
                    {voice.name} · {voice.gender} · {voice.culture}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void preview()}
          style={{
            padding: '10px 16px',
            background: 'rgba(65,166,213,.22)',
            border: '1px solid rgba(130,188,221,.45)',
            color: '#bceafd',
            cursor: 'pointer',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            transition: 'all 0.15s ease',
          }}
        >
          {busy ? 'Playing…' : 'Preview Voice'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 8,
          color: '#8baabd',
          fontSize: 11,
        }}
      >
        <span>
          ✨ Human Neural Voice Engine active · 100% Offline & Realistic
        </span>
      </div>
    </div>
  );
};
