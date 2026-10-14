import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Volume2, X } from 'lucide-react';
import { apiFetch, apiUrl } from '../api';
import { BrowserVoiceSession } from './BrowserVoiceSession';
import { VoiceSelector } from './VoiceSelector';
import './VoiceControl.css';

type VoiceState = { available: boolean; listening: boolean; speaking?: boolean; transcribing?: boolean; starting: boolean; culture: string | null; engine?: string; microphone?: string | null; last_transcription_ms?: number | null; error: string | null };
type ComputerState = { available: boolean; enabled: boolean; voice: VoiceState };
type VoicePreferences = { chatgpt: string; fish: string | null };
type VoiceControlProps = {
  presentation?: 'control' | 'live-modal';
  transcriptionProvider?: 'configured' | 'fish';
  onClose?: () => void;
  onMessageLogged?: (role: 'user' | 'assistant', content: string) => void;
};

export const VoiceControl: React.FC<VoiceControlProps> = ({ presentation = 'control', transcriptionProvider = 'configured', onClose, onMessageLogged }) => {
  const [computer, setComputer] = useState<ComputerState | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [lastTurnTiming, setLastTurnTiming] = useState<{ transcription_ms: number; turn_ms: number } | null>(null);
  const [voicePreference, setVoicePreference] = useState<string | null>(null);
  const [voicePreferenceLoaded, setVoicePreferenceLoaded] = useState(false);
  const browserSessionRef = useRef<BrowserVoiceSession | null>(null);
  const voicePreferenceRef = useRef<string | null>(null);
  const speakingRef = useRef(false);
  const speechGenerationRef = useRef(0);
  const speechQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const turnInFlightRef = useRef(false);
  const turnGenerationRef = useRef(0);
  const activeTurnRequestRef = useRef<AbortController | null>(null);
  const pendingSpeechChunksRef = useRef(0);
  const activeSpeechRequestRef = useRef<AbortController | null>(null);
  const cancelPlayerRef = useRef<(() => void) | null>(null);
  const responseTextRef = useRef('');

  const cancelVoiceTurn = (updateUi = true) => {
    turnGenerationRef.current++;
    activeTurnRequestRef.current?.abort(); activeTurnRequestRef.current = null;
    turnInFlightRef.current = false;
    if (updateUi) { setTranscribing(false); setWorking(false); }
  };

  const reportSpeaking = (speaking: boolean) => {
    speakingRef.current = speaking;
    void apiFetch('/api/v1/voice/browser/state', { method: 'POST', body: JSON.stringify({ speaking }) }).catch(() => {});
  };

  const stopSpeech = () => {
    speechGenerationRef.current++;
    pendingSpeechChunksRef.current = 0;
    activeSpeechRequestRef.current?.abort(); activeSpeechRequestRef.current = null;
    cancelPlayerRef.current?.(); cancelPlayerRef.current = null;
    playerRef.current?.pause();
    playerRef.current = null;
    window.speechSynthesis?.cancel();
    reportSpeaking(false);
  };

  const speakInBrowser = (text: string) => {
    const generation = speechGenerationRef.current;
    pendingSpeechChunksRef.current++;
    speechQueueRef.current = speechQueueRef.current.catch(() => {}).then(async () => {
      if (generation !== speechGenerationRef.current) return;
      reportSpeaking(true);
      try {
        const controller = new AbortController(); activeSpeechRequestRef.current = controller;
        const response = await fetch(apiUrl('/api/v1/voice/browser/synthesize'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice_id: voicePreferenceRef.current }), signal: controller.signal });
        if (!response.ok) throw new Error(await response.text());
        if (response.headers.get('content-type')?.includes('audio/mpeg')) {
          const url = URL.createObjectURL(await response.blob());
          const player = new Audio(url); playerRef.current = player;
          await new Promise<void>((resolve, reject) => {
            const finish = () => { cancelPlayerRef.current = null; resolve(); };
            cancelPlayerRef.current = () => { player.pause(); finish(); };
            player.onended = finish; player.onerror = () => { cancelPlayerRef.current = null; reject(new Error('TJ audio playback failed.')); };
            void player.play().catch((reason) => { cancelPlayerRef.current = null; reject(reason); });
          });
          URL.revokeObjectURL(url);
        } else {
          const descriptor = await response.json() as { voice_id?: string };
          if (!window.speechSynthesis) throw new Error('This browser has no speech synthesis voice available.');
          await new Promise<void>((resolve, reject) => {
            const utterance = new SpeechSynthesisUtterance(text.replace(/\bT\s*J\b/gi, 'Tee Jay'));
            const available = window.speechSynthesis.getVoices();
            const isNatural = (v: SpeechSynthesisVoice) => /natural|online|neural|google|journey/i.test(v.name);
            const isNotRobotic = (v: SpeechSynthesisVoice) => !/desktop|sapi|zira|david/i.test(v.name);
            const female = descriptor.voice_id === 'windows:female' || descriptor.voice_id === 'neural:jenny';
            utterance.voice =
              available.find((voice) => isNatural(voice) && (female ? /jenny|aria|ava/i.test(voice.name) : /guy|andrew/i.test(voice.name))) ||
              available.find((voice) => isNatural(voice) && /en/i.test(voice.lang)) ||
              available.find((voice) => isNotRobotic(voice) && (female ? /female|jenny|aria/i.test(voice.name) : /guy|andrew/i.test(voice.name))) ||
              available.find((voice) => isNotRobotic(voice) && /en/i.test(voice.lang)) ||
              available[0] ||
              null;
            utterance.onend = () => resolve(); utterance.onerror = (event) => reject(new Error(event.error));
            window.speechSynthesis.speak(utterance);
          });
        }
      } catch (reason) {
        if (generation === speechGenerationRef.current && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason.message : 'TJ speech playback failed.');
        }
      } finally {
        activeSpeechRequestRef.current = null;
        if (generation === speechGenerationRef.current) {
          pendingSpeechChunksRef.current = Math.max(0, pendingSpeechChunksRef.current - 1);
          if (pendingSpeechChunksRef.current === 0) reportSpeaking(false);
        }
        playerRef.current = null;
      }
    });
  };

  const refresh = async () => {
    try {
      const state = await apiFetch<ComputerState>('/api/v1/computer/status');
      setComputer(state); setVoice(state.voice); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Voice status unavailable'); }
  };
  useEffect(() => {
    void refresh();
    const openVoicePanel = () => { setExpanded(true); void refresh(); };
    window.addEventListener('tj:voice-open', openVoicePanel);
    const timer = window.setInterval(() => { void apiFetch<VoiceState>('/api/v1/voice/status').then((state) => { setVoice(state); setError(''); }).catch(() => {}); }, 1500);
    const stream = new EventSource('/api/v1/system/events');
    stream.addEventListener('voice.listening', () => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); });
    stream.addEventListener('voice.speaking', () => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); });
    stream.addEventListener('voice.stopped', () => { void apiFetch<VoiceState>('/api/v1/voice/status').then(setVoice).catch(() => {}); });
    stream.addEventListener('system.settings_changed', () => void refresh());
    stream.addEventListener('voice.transcript', (event) => {
      const item = JSON.parse((event as MessageEvent).data) as { summary: string };
      setTranscript(item.summary); setResponse(''); responseTextRef.current = ''; setTranscribing(false);
      onMessageLogged?.('user', item.summary);
    });
    for (const name of ['voice.response', 'voice.error']) stream.addEventListener(name, (event) => {
      const item = JSON.parse((event as MessageEvent).data) as { summary: string; data?: { speech_chunk?: boolean } };
      if (name === 'voice.response' && item.data?.speech_chunk) {
        responseTextRef.current += item.summary;
        setResponse(responseTextRef.current);
        if (browserSessionRef.current) speakInBrowser(item.summary);
      } else { responseTextRef.current = item.summary; setResponse(item.summary); }
      if (name === 'voice.error') setError(item.summary);
    });
    return () => {
      window.removeEventListener('tj:voice-open', openVoicePanel);
      window.clearInterval(timer); stream.close();
      if (browserSessionRef.current) {
        const session = browserSessionRef.current; browserSessionRef.current = null;
        cancelVoiceTurn(false);
        stopSpeech(); void session.stop(); void apiFetch('/api/v1/voice/stop', { method: 'POST' }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (presentation !== 'live-modal') return;
    setVoicePreferenceLoaded(false);
    void apiFetch<VoicePreferences>('/api/v1/voice/live/voice-preferences')
      .then(async (result) => {
        const selected = result[transcriptionProvider === 'fish' ? 'fish' : 'chatgpt'];
        if (selected) { setVoicePreference(selected); return; }
        if (transcriptionProvider === 'fish') {
          const voices = await apiFetch<{ voices: Array<{ id: string }> }>('/api/v1/voice/fish/voices');
          if (voices.voices[0]) {
            const firstFishVoice = `fish:${voices.voices[0].id}`;
            setVoicePreference(firstFishVoice);
            await apiFetch('/api/v1/voice/live/voice-preferences', { method: 'PUT', body: JSON.stringify({ provider: 'fish', voice_id: firstFishVoice }) });
            return;
          }
        }
        setVoicePreference('neural:jenny');
      })
      .catch(() => setVoicePreference('neural:jenny'))
      .finally(() => setVoicePreferenceLoaded(true));
  }, [presentation, transcriptionProvider]);

  const updateVoicePreference = async (voiceId: string | null) => {
    if (!voiceId) return;
    setVoicePreference(voiceId);
    voicePreferenceRef.current = voiceId;
    try {
      await apiFetch('/api/v1/voice/live/voice-preferences', {
        method: 'PUT',
        body: JSON.stringify({ provider: transcriptionProvider === 'fish' ? 'fish' : 'chatgpt', voice_id: voiceId }),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the selected voice.');
    }
  };

  useEffect(() => { voicePreferenceRef.current = voicePreference; }, [voicePreference]);

  const toggle = async () => {
    setWorking(true); setError('');
    try {
      if (browserSessionRef.current) {
        const session = browserSessionRef.current; browserSessionRef.current = null;
        cancelVoiceTurn();
        stopSpeech();
        await session.stop();
        await apiFetch('/api/v1/voice/stop', { method: 'POST' });
        setUserSpeaking(false);
      } else {
        await apiFetch('/api/v1/voice/browser/start', {
          method: 'POST',
          body: JSON.stringify(transcriptionProvider === 'fish' ? { provider: 'fish' } : {}),
        });
        const session = new BrowserVoiceSession({
          onSpeechStart: () => {
            if (speakingRef.current || turnInFlightRef.current || pendingSpeechChunksRef.current > 0) {
              cancelVoiceTurn();
              stopSpeech();
              void apiFetch('/api/v1/voice/interrupt', { method: 'POST' });
            }
          },
          onLevel: setUserSpeaking,
          onTurn: (wav) => {
            if (!browserSessionRef.current) return;
            const generation = ++turnGenerationRef.current;
            const controller = new AbortController();
            activeTurnRequestRef.current = controller;
            setWorking(true);
            setTranscribing(true);
            turnInFlightRef.current = true;
            void wav.arrayBuffer().then((buffer) => {
              let binary = ''; const bytes = new Uint8Array(buffer); const block = 0x8000;
              for (let i = 0; i < bytes.length; i += block) binary += String.fromCharCode(...bytes.subarray(i, i + block));
              return apiFetch<{ response?: string; transcription_ms?: number; turn_ms?: number }>('/api/v1/voice/browser/turn', { method: 'POST', body: JSON.stringify({ wav_base64: btoa(binary) }), signal: controller.signal });
            }).then((result) => {
              if (generation !== turnGenerationRef.current) return;
              if (result.response && !/^Voice listening stopped\./i.test(result.response)) {
                setResponse(result.response);
                onMessageLogged?.('assistant', result.response);
              }
              if (result.transcription_ms != null && result.turn_ms != null) setLastTurnTiming({ transcription_ms: result.transcription_ms, turn_ms: result.turn_ms });
              if (/^Voice listening stopped\./i.test(result.response ?? '')) {
                const current = browserSessionRef.current;
                browserSessionRef.current = null; void current?.stop(); stopSpeech(); setUserSpeaking(false);
                void apiFetch('/api/v1/voice/stop', { method: 'POST' });
              }
            }).catch((reason) => {
              if (generation === turnGenerationRef.current && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(reason instanceof Error ? reason.message : 'Voice turn failed.');
            }).finally(() => {
              if (generation === turnGenerationRef.current) {
                if (activeTurnRequestRef.current === controller) activeTurnRequestRef.current = null;
                turnInFlightRef.current = false; setWorking(false); setTranscribing(false);
              }
            });
          },
        });
        try { await session.start(); browserSessionRef.current = session; }
        catch (reason) { await apiFetch('/api/v1/voice/stop', { method: 'POST' }).catch(() => {}); throw reason; }
      }
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change voice listening'); }
    finally { setWorking(false); }
  };

  const liveModal = presentation === 'live-modal';
  const controls = <section className={`tj-voice-control ${liveModal ? 'tj-live-control-root expanded' : expanded ? 'expanded' : ''}`} aria-label={liveModal ? `${transcriptionProvider === 'fish' ? 'Fish Audio' : 'ChatGPT'} live voice` : 'Hands-free computer control'}>
    <button type="button" className={`tj-voice-pill ${voice?.speaking ? 'speaking' : browserSessionRef.current || voice?.listening ? 'listening' : ''}`} onClick={() => { setExpanded(true); void toggle(); }} aria-pressed={Boolean(browserSessionRef.current || voice?.listening)} disabled={working || (!browserSessionRef.current && !navigator.mediaDevices?.getUserMedia)} title={browserSessionRef.current || voice?.listening ? 'Turn voice control off' : 'Turn voice control on'}>
      {voice?.listening ? <Mic size={18} /> : <MicOff size={18} />}
      <span>{working ? 'CONNECTING…' : voice?.speaking ? 'TJ SPEAKING' : transcribing || voice?.transcribing ? 'TJ TRANSCRIBING' : voice?.listening ? 'TJ LISTENING' : voice?.starting ? 'TJ STARTING…' : liveModal ? 'START LIVE VOICE' : 'VOICE CONTROL'}</span>
      <span className="tj-voice-dot" />
    </button>
    {(expanded || liveModal) && <div className="tj-voice-panel">
      <div className="tj-voice-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Volume2 size={16} /><strong>{liveModal ? transcriptionProvider === 'fish' ? 'Fish Audio · TJ Live Voice' : 'ChatGPT · TJ Live Voice' : 'TJ voice and Windows control'}</strong>
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); liveModal ? onClose?.() : setExpanded(false); }}
          title="Close voice panel"
          style={{ background: 'transparent', border: 'none', color: '#a2faff', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
        >
          <X size={14} />
        </button>
      </div>
      <p>{browserSessionRef.current ? transcribing ? 'Transcribing your turn…' : userSpeaking ? 'Listening to you…' : speakingRef.current ? 'TJ is speaking and still listening.' : 'Live conversation is listening for your voice.' : voice?.available ? voice?.speaking ? 'TJ is speaking; microphone capture is paused.' : voice?.transcribing ? 'TJ is transcribing the last audio clip.' : voice?.listening ? 'TJ is capturing audio from the Windows microphone.' : voice?.starting ? 'TJ is starting microphone capture.' : 'TJ voice is ready to start.' : 'Voice listening is unavailable.'} {!liveModal && (computer?.enabled ? 'Windows computer actions are enabled under TJ permissions.' : 'Windows computer actions are off; conversation can still work.')}</p>
      <small>{browserSessionRef.current ? 'Live conversation is active. Speak naturally; TJ listens while speaking and stops when you begin talking.' : liveModal ? transcriptionProvider === 'fish' ? 'Fish Audio handles speech recognition. TJ replies use your selected connected ChatGPT model and voice.' : 'TJ replies use your selected connected ChatGPT model. Speech recognition uses the configured voice provider.' : 'Click the voice button in this chat to start a conversation. Microphone audio is processed locally unless Fish Audio transcription is selected.'} {!liveModal && 'Windows actions still follow configured permissions and approvals.'} {lastTurnTiming ? `Last response processing: ${(lastTurnTiming.turn_ms / 1000).toFixed(1)}s to completion, ${(lastTurnTiming.transcription_ms / 1000).toFixed(1)}s speech recognition.` : voice?.last_transcription_ms != null ? `Last speech recognition: ${(voice.last_transcription_ms / 1000).toFixed(1)}s.` : ''}</small>
      {userSpeaking && <p className="tj-voice-line" role="status"><b>You:</b> Listening…</p>}
      {transcript && <p className="tj-voice-line"><b>Heard:</b> {transcript}</p>}
      {response && <p className="tj-voice-line" role="status"><b>TJ:</b> {response}</p>}
      {(error || voice?.error) && <p className="tj-voice-error" role="alert">{error || voice?.error}</p>}
    </div>}
  </section>;
  if (liveModal) return <div className="tj-live-voice-overlay tj-live-fish-overlay" role="dialog" aria-modal="true" aria-label={transcriptionProvider === 'fish' ? 'Fish Audio Live Voice' : 'ChatGPT Live Voice'}>
    <header className="tj-live-voice-header">
      <div><div className="tj-live-badge"><span className="tj-live-dot" />TJ LIVE VOICE</div><h2>{transcriptionProvider === 'fish' ? 'Fish Audio conversation' : 'ChatGPT conversation'}</h2></div>
      <button type="button" className="tj-live-btn tj-live-btn-secondary" onClick={onClose}>Close</button>
    </header>
    <main className="tj-live-voice-stage"><div className="tj-live-subtitle-box">
      {response ? <p className="tj-live-ai-speech">{response}</p> : transcript ? <p className="tj-live-user-speech">{transcript}</p> : <p style={{ margin: 0, color: '#94a3b8' }}>Start the microphone, then speak naturally to TJ.</p>}
      {error && <p className="tj-voice-error" role="alert">{error}</p>}
    </div>{controls}{voicePreferenceLoaded && <div className="tj-live-inline-voice-picker">
      <p>{transcriptionProvider === 'fish' ? 'Voice assigned to Fish Audio mode; saved separately from ChatGPT and Gemini.' : 'Voice assigned to this selected ChatGPT model; each ChatGPT model keeps its own choice.'}</p>
      <VoiceSelector value={voicePreference} onChange={(voiceId) => void updateVoicePreference(voiceId)} previewName="TJ" />
    </div>}</main>
  </div>;
  return controls;
};
