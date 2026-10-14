import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Square, X, Sparkles, Send, Key, Eye, EyeOff, ExternalLink, RefreshCw, Volume2 } from 'lucide-react';
import { apiFetch } from '../api';
import './LiveVoiceModal.css';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  onConversationCreated?: (id: string) => void;
  onMessageLogged?: (role: 'user' | 'assistant', content: string) => void;
}

type LiveState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking';

export const GEMINI_LIVE_VOICES = [
  { id: 'Puck', name: '🎙️ Puck · Upbeat, Natural Human', desc: 'Crisp, natural & friendly' },
  { id: 'Charon', name: '🎙️ Charon · Deep, Warm & Grounded', desc: 'Calm, authoritative & warm' },
  { id: 'Kore', name: '🎙️ Kore · Clear, Calm & Empathetic', desc: 'Gentle, clear & natural' },
  { id: 'Fenrir', name: '🎙️ Fenrir · Dynamic & Confident', desc: 'Sharp, energetic & articulate' },
  { id: 'Aoede', name: '🎙️ Aoede · Expressive & Gentle', desc: 'Melodic, smooth & conversational' },
];

const GEMINI_LIVE_WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const GEMINI_LIVE_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

// Resample audio buffer to 16kHz raw 16-bit PCM (little-endian)
function resampleTo16k(inputData: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm16;
  }
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputData.length / ratio);
  const result = new Int16Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const originIdx = i * ratio;
    const idx0 = Math.floor(originIdx);
    const idx1 = Math.min(idx0 + 1, inputData.length - 1);
    const fraction = originIdx - idx0;
    const val0 = inputData[idx0] || 0;
    const val1 = inputData[idx1] || 0;
    const sample = val0 + (val1 - val0) * fraction;
    const clamped = Math.max(-1, Math.min(1, sample));
    result[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
  }
  return result;
}

// Convert 16-bit PCM Int16Array to base64
function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// Convert Gemini base64 raw 24kHz 16-bit PCM into Float32Array for Web Audio
function base64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 32768.0;
  }
  return float32;
}

export const GeminiLiveVoiceModal: React.FC<LiveVoiceModalProps> = ({
  isOpen,
  onClose,
  activeConversationId,
  onConversationCreated,
  onMessageLogged,
}) => {
  const [liveState, setLiveState] = useState<LiveState>('idle');
  const [selectedVoice, setSelectedVoice] = useState('Puck');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showKeyCard, setShowKeyCard] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [userTranscript, setUserTranscript] = useState('');
  const [aiSpeechText, setAiSpeechText] = useState('');
  const [typedQuery, setTypedQuery] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Audio pipeline refs
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);

  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartTimeRef = useRef(0);

  // WebSocket & state refs
  const wsRef = useRef<WebSocket | null>(null);
  const isMutedRef = useRef(false);
  const liveStateRef = useRef<LiveState>('idle');
  const isSpeakingAiRef = useRef(false);

  isMutedRef.current = isMuted;
  liveStateRef.current = liveState;
  isSpeakingAiRef.current = liveState === 'speaking';

  // Load API key and configured voice from backend/localStorage on mount or open
  const loadConfig = useCallback(async () => {
    try {
      const storedKey = localStorage.getItem('tj_gemini_live_key');
      const res = await apiFetch<{ configured: boolean; api_key: string | null; voice: string }>('/api/v1/voice/live/config');
      const activeKey = res.api_key || storedKey || '';
      if (activeKey) {
        setApiKey(activeKey);
        setKeyInput(activeKey);
        setHasApiKey(true);
      } else {
        setHasApiKey(false);
        setShowKeyCard(true);
      }
      if (res.voice) {
        setSelectedVoice(res.voice);
      }
    } catch {
      const storedKey = localStorage.getItem('tj_gemini_live_key');
      if (storedKey) {
        setApiKey(storedKey);
        setKeyInput(storedKey);
        setHasApiKey(true);
      } else {
        setHasApiKey(false);
        setShowKeyCard(true);
      }
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadConfig();
    }
  }, [isOpen, loadConfig]);

  // Save new Gemini Live API key
  const handleSaveApiKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a valid Gemini API key.');
      return;
    }

    setIsSavingKey(true);
    setErrorMsg('');
    try {
      localStorage.setItem('tj_gemini_live_key', trimmed);
      await apiFetch('/api/v1/voice/live/config', {
        method: 'PUT',
        body: JSON.stringify({ api_key: trimmed, voice: selectedVoice }),
      });
      setApiKey(trimmed);
      setHasApiKey(true);
      setShowKeyCard(false);
      // Restart connection
      restartSession(trimmed, selectedVoice);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save Gemini API key.');
    } finally {
      setIsSavingKey(false);
    }
  };

  // Instant barge-in / interrupt AI speech
  const interruptAi = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {}
    }
    activeSourcesRef.current = [];
    if (outputAudioCtxRef.current) {
      nextStartTimeRef.current = outputAudioCtxRef.current.currentTime;
    }
    setLiveState('listening');
  }, []);

  // Queue and play incoming 24kHz PCM chunk seamlessly
  const queueAudioChunk = useCallback((float32: Float32Array) => {
    let ctx = outputAudioCtxRef.current;
    if (!ctx) {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      outputAnalyserRef.current = analyser;
    }

    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const analyser = outputAnalyserRef.current!;
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(analyser);
    analyser.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    const startTime = Math.max(currentTime, nextStartTimeRef.current);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration;

    activeSourcesRef.current.push(source);
    setLiveState('speaking');

    source.onended = () => {
      const idx = activeSourcesRef.current.indexOf(source);
      if (idx !== -1) activeSourcesRef.current.splice(idx, 1);
      if (activeSourcesRef.current.length === 0 && (!nextStartTimeRef.current || nextStartTimeRef.current <= ctx.currentTime + 0.1)) {
        setLiveState('listening');
      }
    };
  }, []);

  // Clean up all audio nodes and sockets
  const cleanupSession = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close(1000, 'Session closed');
      } catch {}
      wsRef.current = null;
    }

    if (processorNodeRef.current) {
      try {
        processorNodeRef.current.disconnect();
      } catch {}
      processorNodeRef.current = null;
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }

    if (inputAudioCtxRef.current) {
      try {
        void inputAudioCtxRef.current.close();
      } catch {}
      inputAudioCtxRef.current = null;
    }

    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {}
    }
    activeSourcesRef.current = [];

    if (outputAudioCtxRef.current) {
      try {
        void outputAudioCtxRef.current.close();
      } catch {}
      outputAudioCtxRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    setLiveState('idle');
  }, []);

  // Start Gemini Live WebSocket session
  const startSession = useCallback(async (currentKey: string, voiceName: string) => {
    if (!currentKey) {
      setShowKeyCard(true);
      return;
    }

    cleanupSession();
    setErrorMsg('');
    setLiveState('connecting');

    try {
      // 1. Setup Audio Output context
      const outCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      outputAudioCtxRef.current = outCtx;
      const outAnalyser = outCtx.createAnalyser();
      outAnalyser.fftSize = 256;
      outputAnalyserRef.current = outAnalyser;
      nextStartTimeRef.current = 0;

      // 2. Setup Audio Input capture
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;

      const inCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      inputAudioCtxRef.current = inCtx;
      const inAnalyser = inCtx.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;

      const micSource = inCtx.createMediaStreamSource(stream);
      micSource.connect(inAnalyser);

      // ScriptProcessor for audio streaming
      const processor = inCtx.createScriptProcessor(4096, 1, 1);
      processorNodeRef.current = processor;
      micSource.connect(processor);
      processor.connect(inCtx.destination);

      // 3. Connect to Gemini Live WebSocket
      const wsUrl = `${GEMINI_LIVE_WS_BASE}?key=${encodeURIComponent(currentKey)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setLiveState('listening');
        // Send initial setup message
        const setupMessage = {
          setup: {
            model: GEMINI_LIVE_MODEL,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: voiceName || 'Puck',
                  },
                },
              },
            },
            systemInstruction: {
              parts: [
                {
                  text: 'You are TJ, the user\'s real-time AI companion, executive co-pilot, and mastery intelligence. You talk directly with the user with a real, warm, natural, human conversational voice. Speak concisely, clearly, and naturally like a knowledgeable partner in live dialogue. Never use markdown formatting, bullets, or asterisks in spoken responses. Answer directly and warmly.',
                },
              ],
            },
          },
        };
        ws.send(JSON.stringify(setupMessage));
      };

      // Mic input audio processor
      processor.onaudioprocess = (e) => {
        if (isMutedRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputChannel = e.inputBuffer.getChannelData(0);

        // Calculate RMS volume for speech activity and visualizer
        let sum = 0;
        for (let i = 0; i < inputChannel.length; i++) {
          sum += inputChannel[i] * inputChannel[i];
        }
        const rms = Math.sqrt(sum / inputChannel.length);

        // Proactive client-side barge-in: If user speaks while AI is speaking, interrupt playback immediately
        if (rms > 0.045 && liveStateRef.current === 'speaking') {
          interruptAi();
        }

        // Resample to 16kHz Int16 PCM
        const pcm16 = resampleTo16k(inputChannel, inCtx.sampleRate);
        const base64Audio = int16ToBase64(pcm16);

        // Send audio chunk to Gemini Live
        const audioMessage = {
          realtimeInput: {
            audio: {
              data: base64Audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          },
        };
        try {
          wsRef.current.send(JSON.stringify(audioMessage));
        } catch {}
      };

      // Handle server responses from Gemini Live
      ws.onmessage = (event) => {
        try {
          let data: any;
          if (typeof event.data === 'string') {
            data = JSON.parse(event.data);
          } else {
            return;
          }

          if (data.serverContent) {
            const sc = data.serverContent;

            // Barge-in interruption signal from Gemini
            if (sc.interrupted) {
              interruptAi();
              return;
            }

            // Streamed model speech audio
            if (sc.modelTurn?.parts) {
              for (const part of sc.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const float32 = base64ToFloat32(part.inlineData.data);
                  queueAudioChunk(float32);
                }
                if (part.text) {
                  setAiSpeechText((prev) => prev + part.text);
                  onMessageLogged?.('assistant', part.text);
                }
              }
            }

            // Live user transcription
            if (sc.inputTranscription?.text) {
              setUserTranscript(sc.inputTranscription.text);
              onMessageLogged?.('user', sc.inputTranscription.text);
            }

            // Live output transcription
            if (sc.outputTranscription?.text) {
              setAiSpeechText((prev) => prev + sc.outputTranscription.text);
              onMessageLogged?.('assistant', sc.outputTranscription.text);
            }

            if (sc.turnComplete && activeSourcesRef.current.length === 0) {
              setLiveState('listening');
            }
          }
        } catch (err) {
          console.warn('Live voice message parse error:', err);
        }
      };

      ws.onerror = () => {
        setErrorMsg('Gemini Live connection error. Check your API key and network.');
        setLiveState('idle');
      };

      ws.onclose = (event) => {
        if (event.code !== 1000) {
          setErrorMsg(
            event.reason ||
              'Gemini Live session disconnected. Please verify your Gemini API key has access to the Live API.'
          );
        }
        setLiveState('idle');
      };
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to start Gemini Live voice session.');
      setLiveState('idle');
    }
  }, [cleanupSession, interruptAi, onMessageLogged, queueAudioChunk]);

  const restartSession = useCallback((key: string, voice: string) => {
    void startSession(key, voice);
  }, [startSession]);

  // Handle voice change
  const handleVoiceChange = (newVoice: string) => {
    setSelectedVoice(newVoice);
    void apiFetch('/api/v1/voice/live/config', {
      method: 'PUT',
      body: JSON.stringify({ voice: newVoice }),
    }).catch(() => {});
    if (hasApiKey && apiKey) {
      restartSession(apiKey, newVoice);
    }
  };

  // Send typed query to Gemini Live
  const submitTextTurn = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    interruptAi();
    setUserTranscript(trimmed);
    setAiSpeechText('');
    setLiveState('thinking');
    onMessageLogged?.('user', trimmed);

    const clientMsg = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: trimmed }],
          },
        ],
        turnComplete: true,
      },
    };
    wsRef.current.send(JSON.stringify(clientMsg));
  };

  // Setup Neural Orb Canvas Animation
  useEffect(() => {
    if (!isOpen) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let angle = 0;
    const inBuffer = new Uint8Array(128);
    const outBuffer = new Uint8Array(128);

    const render = () => {
      animFrameRef.current = requestAnimationFrame(render);

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Read audio data
      let amp = 0;
      if (liveStateRef.current === 'speaking' && outputAnalyserRef.current) {
        outputAnalyserRef.current.getByteFrequencyData(outBuffer);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += outBuffer[i];
        amp = (sum / 32) / 255;
      } else if (liveStateRef.current === 'listening' && inputAnalyserRef.current && !isMutedRef.current) {
        inputAnalyserRef.current.getByteFrequencyData(inBuffer);
        let sum = 0;
        for (let i = 0; i < 32; i++) sum += inBuffer[i];
        amp = (sum / 32) / 255;
      }

      angle += 0.02 + amp * 0.05;

      // Glow color palette based on state
      let color1 = '#0ea5e9';
      let color2 = '#38bdf8';
      let color3 = '#818cf8';

      if (liveStateRef.current === 'speaking') {
        color1 = '#8b5cf6';
        color2 = '#c084fc';
        color3 = '#e879f9';
      } else if (liveStateRef.current === 'thinking') {
        color1 = '#f59e0b';
        color2 = '#fbbf24';
        color3 = '#38bdf8';
      } else if (liveStateRef.current === 'connecting') {
        color1 = '#06b6d4';
        color2 = '#3b82f6';
        color3 = '#6366f1';
      }

      // Outer radial glow
      const baseRadius = 65 + amp * 42;
      const glowGrad = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.4, centerX, centerY, baseRadius * 1.6);
      glowGrad.addColorStop(0, color1 + '55');
      glowGrad.addColorStop(0.5, color2 + '25');
      glowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.6, 0, Math.PI * 2);
      ctx.fill();

      // Fluid orb layers
      for (let layer = 0; layer < 3; layer++) {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(angle * (layer % 2 === 0 ? 1 : -1) + layer * 1.2);

        ctx.beginPath();
        const points = 16;
        for (let i = 0; i <= points; i++) {
          const theta = (i / points) * Math.PI * 2;
          const wobble = Math.sin(theta * 3 + angle * 2) * (8 + amp * 22);
          const r = baseRadius + wobble - layer * 12;
          const x = Math.cos(theta) * r;
          const y = Math.sin(theta) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();

        const grad = ctx.createLinearGradient(-baseRadius, -baseRadius, baseRadius, baseRadius);
        grad.addColorStop(0, layer === 0 ? color1 : layer === 1 ? color2 : color3);
        grad.addColorStop(1, color1);
        ctx.fillStyle = grad;
        ctx.globalAlpha = 0.55 - layer * 0.12;
        ctx.fill();
        ctx.restore();
      }

      // Center bright core
      const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 38 + amp * 18);
      coreGrad.addColorStop(0, '#ffffff');
      coreGrad.addColorStop(0.4, color2);
      coreGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 38 + amp * 18, 0, Math.PI * 2);
      ctx.fill();
    };

    render();

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isOpen]);

  // Initial trigger on modal open
  useEffect(() => {
    if (isOpen && hasApiKey && apiKey && !wsRef.current) {
      void startSession(apiKey, selectedVoice);
    }
    return () => {
      if (!isOpen) {
        cleanupSession();
      }
    };
  }, [isOpen, hasApiKey, apiKey, selectedVoice, startSession, cleanupSession]);

  if (!isOpen) return null;

  return (
    <div className="tj-live-voice-overlay" role="dialog" aria-modal="true">
      {/* Top Header */}
      <div className="tj-live-voice-header">
        <div className="tj-live-badge">
          <div className={`tj-live-dot ${liveState}`} />
          <span>
            {liveState === 'speaking'
              ? 'TJ Speaking'
              : liveState === 'thinking'
              ? 'Thinking…'
              : liveState === 'listening'
              ? 'Live Listening'
              : liveState === 'connecting'
              ? 'Connecting Gemini Live…'
              : 'Live Voice Ready'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Gemini Live Voice selector */}
          <select
            value={selectedVoice}
            onChange={(e) => handleVoiceChange(e.target.value)}
            className="tj-live-voice-select"
            aria-label="Select Gemini Voice"
            title="Select Gemini Live natural human voice"
          >
            {GEMINI_LIVE_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>

          {/* Key configuration toggle */}
          <button
            type="button"
            onClick={() => setShowKeyCard((prev) => !prev)}
            aria-label="Gemini API Key Settings"
            className="tj-live-icon-btn"
            title="Configure Gemini Live API Key"
          >
            <Key size={16} />
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Live Voice"
            className="tj-live-icon-btn"
            title="Close Live Voice"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Center Stage: API Key Setup Card or Live Neural Orb */}
      <div className="tj-live-voice-stage">
        {showKeyCard || !hasApiKey ? (
          <div className="tj-live-key-card">
            <h3 className="tj-live-key-title">
              <Sparkles size={20} color="#38bdf8" />
              Connect Gemini Live
            </h3>
            <p className="tj-live-key-desc">
              Experience authentic, human-level conversational voice with zero lag, instant interruption, and real natural voices like ChatGPT and Gemini.
            </p>

            <form onSubmit={handleSaveApiKey} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="tj-live-key-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Paste your Gemini API key (AIzaSy...)"
                  className="tj-live-key-input"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="tj-live-key-eye-btn"
                  title={showPassword ? 'Hide Key' : 'Show Key'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>

              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="tj-live-key-link"
              >
                <span>Get a free Gemini API key from Google AI Studio</span>
                <ExternalLink size={12} />
              </a>

              {/* Voice selection pills */}
              <div style={{ marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Choose Voice
                </span>
                <div className="tj-live-voices-grid" style={{ marginTop: 6 }}>
                  {GEMINI_LIVE_VOICES.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setSelectedVoice(v.id)}
                      className={`tj-live-voice-chip ${selectedVoice === v.id ? 'active' : ''}`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                <button
                  type="submit"
                  disabled={isSavingKey || !keyInput.trim()}
                  className="tj-live-btn tj-live-btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {isSavingKey ? 'Connecting…' : 'Connect & Start Voice'}
                </button>
                {hasApiKey && (
                  <button
                    type="button"
                    onClick={() => setShowKeyCard(false)}
                    className="tj-live-btn tj-live-btn-secondary"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="tj-orb-container" onClick={liveState === 'speaking' ? interruptAi : undefined}>
              <canvas
                ref={canvasRef}
                width={260}
                height={260}
                className="tj-orb-canvas"
                title={liveState === 'speaking' ? 'Click to interrupt TJ' : 'Interactive neural voice orb'}
              />
            </div>

            <div className="tj-live-state-label">
              {liveState === 'speaking'
                ? 'TJ is speaking · Speak or click orb to interrupt'
                : liveState === 'thinking'
                ? 'TJ is thinking…'
                : liveState === 'connecting'
                ? 'Connecting to Gemini Live…'
                : isMuted
                ? 'Microphone muted'
                : 'Listening to you… Speak naturally'}
            </div>

            {/* Live Subtitle Box */}
            <div className="tj-live-subtitle-box">
              {aiSpeechText ? (
                <p className="tj-live-ai-speech">{aiSpeechText}</p>
              ) : userTranscript ? (
                <p className="tj-live-user-speech">"{userTranscript}"</p>
              ) : (
                <p style={{ margin: 0, color: '#64748b', fontSize: 14 }}>
                  Say anything to TJ… Try: "What can you do?", "Help me brainstorm", or "Check system status"
                </p>
              )}
            </div>

            {/* Quick text input fallback */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (typedQuery.trim()) {
                  const q = typedQuery;
                  setTypedQuery('');
                  submitTextTurn(q);
                }
              }}
              className="tj-live-text-input-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                maxWidth: 520,
                marginTop: 12,
                padding: '4px 6px 4px 14px',
                background: 'rgba(15, 23, 42, 0.75)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: 24,
                boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
              }}
            >
              <input
                type="text"
                value={typedQuery}
                onChange={(e) => setTypedQuery(e.target.value)}
                placeholder="Type or speak naturally to TJ…"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#f8fafc',
                  fontSize: 13,
                }}
              />
              <button
                type="submit"
                disabled={!typedQuery.trim() || liveState === 'connecting'}
                style={{
                  background: 'linear-gradient(135deg, #0284c7, #38bdf8)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  cursor: typedQuery.trim() ? 'pointer' : 'default',
                  opacity: typedQuery.trim() ? 1 : 0.4,
                  transition: 'all 0.15s ease',
                }}
                title="Send text to TJ"
              >
                <Send size={14} />
              </button>
            </form>
          </>
        )}

        {errorMsg && (
          <div role="alert" style={{ color: '#f87171', fontSize: 13, textAlign: 'center', maxWidth: 480 }}>
            {errorMsg}
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="tj-live-controls">
        <button
          type="button"
          onClick={() => setIsMuted((m) => !m)}
          className={`tj-live-btn ${isMuted ? 'tj-live-btn-danger' : 'tj-live-btn-secondary'}`}
        >
          {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
          <span>{isMuted ? 'Unmute Mic' : 'Mute Mic'}</span>
        </button>

        {liveState === 'speaking' && (
          <button type="button" onClick={interruptAi} className="tj-live-btn tj-live-btn-secondary">
            <Square size={14} />
            <span>Interrupt</span>
          </button>
        )}

        {liveState === 'idle' && hasApiKey && (
          <button
            type="button"
            onClick={() => restartSession(apiKey, selectedVoice)}
            className="tj-live-btn tj-live-btn-secondary"
          >
            <RefreshCw size={14} />
            <span>Reconnect</span>
          </button>
        )}

        <button type="button" onClick={onClose} className="tj-live-btn tj-live-btn-primary">
          <span>End Live Conversation</span>
        </button>
      </div>
    </div>
  );
};
