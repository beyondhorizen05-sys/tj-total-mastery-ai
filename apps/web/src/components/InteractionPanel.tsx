import React, { useEffect, useState } from 'react';
import { MessageSquare, Mic, FileText, Send, Sparkles, AlertCircle } from 'lucide-react';
import type { TJPersona } from '@tj/schemas';

interface Props {
  persona: TJPersona;
  messages: Array<{ id: string; role: 'user' | 'assistant' | 'system'; content: string }>;
  loading: boolean;
  error: string | null;
  onSend: (text: string) => void;
}

export const InteractionPanel: React.FC<Props> = ({ persona, messages, loading, error, onSend }) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'voice' | 'notes'>('chat');
  const [quickInput, setQuickInput] = useState('');
  const [notes, setNotes] = useState('');
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); window.dispatchEvent(new CustomEvent('tj:voice-state', { detail: 'idle' })); }, []);
  const speakLatest = () => {
    if (!('speechSynthesis' in window)) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); window.dispatchEvent(new CustomEvent('tj:voice-state', { detail: 'idle' })); return; }
    const latest = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!latest) return;
    const utterance = new SpeechSynthesisUtterance(latest.content);
    const voice = window.speechSynthesis.getVoices().find((item) => item.voiceURI === persona.voice_id);
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { setSpeaking(true); window.dispatchEvent(new CustomEvent('tj:voice-state', { detail: 'speaking' })); window.dispatchEvent(new Event('tj:voice-pulse')); };
    utterance.onboundary = () => window.dispatchEvent(new Event('tj:voice-pulse'));
    utterance.onend = utterance.onerror = () => { setSpeaking(false); window.dispatchEvent(new CustomEvent('tj:voice-state', { detail: 'idle' })); };
    window.speechSynthesis.speak(utterance);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim() || loading) return;
    const txt = quickInput;
    setQuickInput('');
    onSend(txt);
  };

  return (
    <aside className="tj-interaction-panel" style={{
      width: 350, height: '100%', display: 'flex', flexDirection: 'column',
      background: 'rgba(7, 13, 26, 0.75)', backdropFilter: 'blur(16px)',
      borderLeft: '1px solid var(--border-subtle)', overflow: 'hidden',
    }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 4 }}>
        {[
          { id: 'chat', label: 'COMMS', icon: MessageSquare },
          { id: 'voice', label: 'VOICE', icon: Mic },
          { id: 'notes', label: 'NOTES', icon: FileText },
        ].map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id} onClick={() => setActiveTab(t.id as any)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '6px 2px', borderRadius: 4, border: '1px solid',
                borderColor: isActive ? 'var(--accent-cyan)' : 'transparent',
                background: isActive ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                fontSize: '0.65rem', fontFamily: 'JetBrains Mono', fontWeight: 700, cursor: 'pointer',
              }}
            >
              <Icon size={12} /><span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {activeTab === 'chat' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 10, gap: 8, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', padding: 12 }}>
                <Sparkles size={24} color="var(--accent-cyan)" style={{ margin: '0 auto 6px' }} />
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>No Active Dialogue</div>
                <div style={{ fontSize: '0.68rem', marginTop: 2 }}>Dispatch a directive or converse below.</div>
              </div>
            ) : (
              messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '88%',
                      background: isUser ? 'rgba(37, 99, 235, 0.5)' : 'rgba(14, 24, 46, 0.85)',
                      border: `1px solid ${isUser ? 'rgba(0, 242, 254, 0.4)' : 'var(--border-subtle)'}`,
                      padding: '7px 10px', borderRadius: 6, fontSize: '0.78rem', lineHeight: 1.4,
                      color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}
                  >
                    <div style={{ fontSize: '0.6rem', fontFamily: 'JetBrains Mono', color: isUser ? 'var(--accent-cyan)' : 'var(--accent-purple)', marginBottom: 2 }}>
                      {isUser ? 'OPERATOR' : persona.name.toUpperCase()}
                    </div>
                    {m.content}
                  </div>
                );
              })
            )}

            {loading && (
              <div style={{ alignSelf: 'flex-start', background: 'rgba(14, 24, 46, 0.85)', padding: '5px 10px', borderRadius: 6, fontSize: '0.72rem', color: 'var(--accent-cyan)', fontStyle: 'italic' }}>
                Analyzing directive & routing...
              </div>
            )}

            {error && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(244, 63, 94, 0.1)', color: '#fb7185', padding: '6px 8px', borderRadius: 4, fontSize: '0.72rem' }}>
                <AlertCircle size={13} /> {error}
              </div>
            )}
          </div>
        )}

        {activeTab === 'voice' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, textAlign: 'center', gap: 10 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(0, 242, 254, 0.1)', border: '2px dashed var(--accent-cyan)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Mic size={24} color="var(--accent-cyan)" />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>TJ VOICE</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{'speechSynthesis' in window ? 'Play the latest reply with your selected system voice.' : 'Speech output is unavailable in this browser.'}</div>
            </div>
            <button onClick={speakLatest} disabled={!('speechSynthesis' in window) || !messages.some((m) => m.role === 'assistant')} style={{ background: 'var(--accent-cyan-dim)', color: 'var(--accent-cyan)', border: '1px solid var(--accent-cyan)', borderRadius: 4, padding: '8px 14px', cursor: 'pointer' }}>{speaking ? 'Stop speaking' : 'Speak latest reply'}</button>
          </div>
        )}

        {activeTab === 'notes' && (
          <div style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column' }}>
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Temporary notes for this session…"
              style={{
                flex: 1, background: 'rgba(5, 10, 22, 0.6)', border: '1px solid var(--border-subtle)',
                borderRadius: 4, padding: 8, color: 'var(--text-main)', fontSize: '0.72rem',
                fontFamily: 'JetBrains Mono', outline: 'none', resize: 'none',
              }}
            />
          </div>
        )}
      </div>

      {activeTab === 'chat' && (
        <form onSubmit={handleSend} style={{ padding: 8, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 6 }}>
          <input
            type="text" value={quickInput} onChange={(e) => setQuickInput(e.target.value)}
            disabled={loading} placeholder="Message TJ..."
            style={{ flex: 1, padding: '7px 10px', background: 'rgba(5, 10, 22, 0.85)', border: '1px solid var(--border-subtle)', borderRadius: 4, color: '#fff', fontSize: '0.78rem', outline: 'none' }}
          />
          <button
            type="submit" disabled={loading || !quickInput.trim()}
            style={{ padding: '0 12px', background: 'var(--accent-cyan)', border: 'none', borderRadius: 4, color: '#000', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
          >
            <Send size={12} />
          </button>
        </form>
      )}
    </aside>
  );
};
