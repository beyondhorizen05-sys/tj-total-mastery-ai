import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { VoiceControl } from './VoiceControl';
import { GeminiLiveVoiceModal } from './GeminiLiveVoiceModal';
import './LiveVoiceModal.css';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeConversationId: string | null;
  onConversationCreated?: (id: string) => void;
  onMessageLogged?: (role: 'user' | 'assistant', content: string) => void;
}

type Provider = 'gemini' | 'fish' | 'chatgpt';

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = (props) => {
  const [provider, setProvider] = useState<Provider>('chatgpt');
  const [fishConfigured, setFishConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!props.isOpen) return;
    void apiFetch<{ configured: boolean }>('/api/v1/voice/fish/config')
      .then((config) => setFishConfigured(config.configured))
      .catch(() => setFishConfigured(false));
  }, [props.isOpen]);

  if (!props.isOpen) return null;

  return <>
    {provider === 'gemini' ? <GeminiLiveVoiceModal {...props} /> : provider === 'chatgpt'
      ? <VoiceControl presentation="live-modal" transcriptionProvider="configured" onClose={props.onClose} onMessageLogged={props.onMessageLogged} />
      : fishConfigured
      ? <VoiceControl presentation="live-modal" transcriptionProvider="fish" onClose={props.onClose} onMessageLogged={props.onMessageLogged} />
      : <div className="tj-live-voice-overlay tj-live-fish-overlay" role="dialog" aria-modal="true" aria-label="Fish Audio setup">
          <header className="tj-live-voice-header">
            <div><div className="tj-live-badge"><span className="tj-live-dot" />TJ LIVE VOICE</div><h2>Connect Fish Audio</h2></div>
            <button type="button" className="tj-live-btn tj-live-btn-secondary" onClick={props.onClose}>Close</button>
          </header>
          <main className="tj-live-voice-stage"><p>Fish Audio isn’t connected yet. Add its API key in Settings → Voice, then reopen Live Voice.</p></main>
        </div>}
    <nav className="tj-live-provider-switch" aria-label="Live Voice provider">
      <button type="button" className={provider === 'gemini' ? 'active' : ''} onClick={() => setProvider('gemini')}>Gemini Live</button>
      <button type="button" className={provider === 'fish' ? 'active' : ''} onClick={() => setProvider('fish')}>Fish Audio</button>
      <button type="button" className={provider === 'chatgpt' ? 'active' : ''} onClick={() => setProvider('chatgpt')}>ChatGPT</button>
    </nav>
  </>;
};
