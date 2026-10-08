import React, { useEffect, useState } from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';
import { apiFetch } from '../api';
import './VoiceControl.css';

type VoiceState = { available: boolean; listening: boolean; speaking?: boolean; transcribing?: boolean; starting: boolean; culture: string | null; engine?: string; microphone?: string | null; last_transcription_ms?: number | null; error: string | null };
type ComputerState = { available: boolean; enabled: boolean; voice: VoiceState };

export const VoiceControl: React.FC = () => {
  const [computer, setComputer] = useState<ComputerState | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = async () => {
    try {
      const state = await apiFetch<ComputerState>('/api/v1/computer/status');
      setComputer(state); setVoice(state.voice); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Voice status unavailable'); }
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); }, 7000);
    const stream = new EventSource('/api/v1/system/events');
    stream.addEventListener('voice.listening', () => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); });
    stream.addEventListener('voice.speaking', () => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); });
    stream.addEventListener('voice.stopped', () => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); });
    stream.addEventListener('system.settings_changed', () => void refresh());
    stream.addEventListener('voice.transcript', (event) => {
      const item = JSON.parse((event as MessageEvent).data) as { summary: string };
      setTranscript(item.summary);
    });
    for (const name of ['voice.response', 'voice.error']) stream.addEventListener(name, (event) => {
      const item = JSON.parse((event as MessageEvent).data) as { summary: string };
      setResponse(item.summary);
      if (name === 'voice.error') setError(item.summary);
    });
    return () => { window.clearInterval(timer); stream.close(); };
  }, []);

  const toggle = async () => {
    setWorking(true); setError('');
    try {
      await apiFetch(voice?.listening || voice?.starting ? '/api/v1/voice/stop' : '/api/v1/voice/start', { method: 'POST' });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change voice listening'); }
    finally { setWorking(false); }
  };

  return <section className={`tj-voice-control ${expanded ? 'expanded' : ''}`} aria-label="Hands-free computer control">
    <button type="button" className={`tj-voice-pill ${voice?.speaking ? 'speaking' : voice?.listening ? 'listening' : ''}`} onClick={() => { setExpanded((open) => !open); void refresh(); }} aria-expanded={expanded}>
      {voice?.listening ? <Mic size={18} /> : <MicOff size={18} />}
      <span>{voice?.speaking ? 'TJ SPEAKING' : voice?.transcribing ? 'TJ TRANSCRIBING' : voice?.listening ? 'TJ LISTENING' : voice?.starting ? 'TJ STARTING…' : 'VOICE CONTROL'}</span>
      <span className="tj-voice-dot" />
    </button>
    {expanded && <div className="tj-voice-panel">
      <div className="tj-voice-heading"><Volume2 size={16} /><strong>TJ voice and Windows control</strong></div>
      <p>{voice?.available ? voice?.speaking ? 'TJ is speaking; microphone capture is paused.' : voice?.transcribing ? 'TJ is transcribing the last audio clip.' : voice?.listening ? 'TJ is capturing audio from the Windows microphone.' : voice?.starting ? 'TJ is starting microphone capture.' : 'TJ voice is ready to start.' : 'Windows voice listening is unavailable.'} {computer?.enabled ? 'Windows computer actions are enabled under TJ permissions.' : 'Windows computer actions are off; conversation can still work.'}</p>
      <button type="button" className="tj-voice-toggle" disabled={!voice?.available || working} onClick={() => void toggle()}>{voice?.listening || voice?.starting || voice?.speaking ? 'Stop listening' : 'Start listening'}</button>
      <small>{voice?.engine === 'fish-audio' || voice?.engine === 'local-whisper' ? 'Speak naturally in your language. Say a computer action only when you want TJ to control Windows.' : 'Try “TJ open notepad”, “TJ scroll down”, or “TJ press enter”.'} Say “read the screen” for local app text. “Visually read the screen” sends a screenshot to a configured vision provider and may require approval. {voice?.last_transcription_ms != null ? `Last speech recognition: ${(voice.last_transcription_ms / 1000).toFixed(1)}s.` : ''}</small>
      {transcript && <p className="tj-voice-line"><b>Heard:</b> {transcript}</p>}
      {response && <p className="tj-voice-line" role="status"><b>TJ:</b> {response}</p>}
      {(error || voice?.error) && <p className="tj-voice-error" role="alert">{error || voice?.error}</p>}
    </div>}
  </section>;
};
