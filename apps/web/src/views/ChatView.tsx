import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../api';
import { Send, Sparkles, AlertCircle } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const ChatView: React.FC = () => {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'auto' | 'chat' | 'build'>('auto');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: any[] }>('/api/v1/conversations');
      setConversations(res.conversations);
      if (res.conversations.length > 0 && !activeConvId) {
        setActiveConvId(res.conversations[0].id);
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  const loadMessages = async (id: string) => {
    try {
      const res = await apiFetch<{ messages: Message[] }>(`/api/v1/conversations/${id}/messages`);
      setMessages(res.messages);
    } catch (e: any) {
      console.error(e);
    }
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => { if (activeConvId) loadMessages(activeConvId); }, [activeConvId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userText = input;
    setInput('');
    setError(null);
    setLoading(true);

    setMessages((prev) => [...prev, { id: 'temp-' + Date.now(), role: 'user', content: userText }]);

    try {
      const res = await apiFetch<any>('/api/v1/chat', {
        method: 'POST',
        body: JSON.stringify({ conversation_id: activeConvId ?? undefined, content: userText, mode }),
      });
      if (!activeConvId && res.conversation_id) {
        setActiveConvId(res.conversation_id);
        loadConversations();
      }
      setMessages((prev) => [...prev, { id: res.message?.id ?? 'bot-' + Date.now(), role: 'assistant', content: res.content }]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 16 }}>
      {/* Threads Sidebar */}
      <div style={{ width: 220, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', padding: 12 }}>
        <button
          onClick={() => { setActiveConvId(null); setMessages([]); }}
          style={{ padding: '8px 12px', background: 'var(--accent-blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer', marginBottom: 12 }}
        >
          + New Chat
        </button>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {conversations.map((c) => (
            <div
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              style={{
                padding: '8px 12px', borderRadius: 6,
                background: c.id === activeConvId ? 'var(--bg-card-hover)' : 'transparent',
                cursor: 'pointer', fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                color: c.id === activeConvId ? 'var(--text-main)' : 'var(--text-muted)',
              }}
            >
              {c.title}
            </div>
          ))}
        </div>
      </div>

      {/* Main Stream */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-subtle)', padding: 16, height: '100%' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Sparkles size={40} style={{ margin: '0 auto 12px', color: 'var(--accent-cyan)' }} />
              <h3>How can TJ assist you today?</h3>
              <p style={{ fontSize: '0.85rem', marginTop: 6 }}>Type an instruction in Auto mode to let TJ plan and orchestrate autonomous agents.</p>
            </div>
          )}

          {messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '75%',
                  background: isUser ? 'var(--accent-blue)' : 'var(--bg-card)',
                  color: isUser ? '#fff' : 'var(--text-main)', padding: '12px 16px', borderRadius: 8,
                  border: isUser ? 'none' : '1px solid var(--border-subtle)', whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5,
                }}
              >
                {m.content}
              </div>
            );
          })}

          {loading && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--bg-card)', padding: '10px 16px', borderRadius: 8, fontSize: '0.85rem', color: 'var(--accent-cyan)', fontStyle: 'italic' }}>
              Thinking and orchestrating...
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(244, 63, 94, 0.1)', color: '#fb7185', padding: '10px 14px', borderRadius: 6, fontSize: '0.85rem' }}>
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {(['auto', 'chat', 'build'] as const).map((m) => (
              <button
                type="button" key={m} onClick={() => setMode(m)}
                style={{
                  padding: '4px 10px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
                  border: '1px solid var(--border-subtle)', background: mode === m ? 'var(--border-strong)' : 'transparent',
                  color: mode === m ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                {m}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Give TJ a task or ask a question..." disabled={loading}
              style={{ flex: 1, padding: '12px 16px', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-main)', fontSize: '0.9rem', outline: 'none' }}
            />
            <button
              type="submit" disabled={loading || !input.trim()}
              style={{
                padding: '0 20px', background: 'var(--accent-cyan)', border: 'none', borderRadius: 6, color: '#000',
                fontWeight: 600, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
