import React, { useState, useEffect, useRef } from 'react';
import { apiChatStream, apiFetch } from '../api';
import { Send, Sparkles, AlertCircle, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { VoiceControl } from '../components/VoiceControl';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  trace?: { routed_model_id?: string; routed_via?: string } | null;
}

interface ImprovementRun {
  id: string;
  state: 'queued' | 'planning' | 'editing' | 'verifying' | 'awaiting_approval' | 'awaiting_deployment_approval' | 'deploying' | 'completed' | 'failed' | 'rolled_back';
  stage: string;
  files: string[];
  checks: Array<{ command: string; exit_code: number }>;
  diff: string;
  error: string | null;
  approval_id?: string | null;
}

interface CapabilityWorkflow {
  approval_id: string;
  status: 'pending_approval' | 'denied' | 'adding_ability' | 'awaiting_activation' | 'running_original_task' | 'completed' | 'failed';
  capability_name: string;
  reason: string;
  message: string;
  result?: string | { content?: string };
}

type ChatMode = 'auto' | 'chat' | 'build' | 'improve';
const CHAT_MODE_STORAGE_PREFIX = 'tj-chat-mode:';
const GLOBAL_CHAT_MODE_STORAGE_KEY = 'tj-global-chat-mode';
const ACTIVE_CONVERSATION_STORAGE_KEY = 'tj-active-conversation';
const DRAFT_CONVERSATION_ID = 'draft';
const CHAT_MODE_STORAGE_KEY = (conversationId: string | null) => `${CHAT_MODE_STORAGE_PREFIX}${conversationId ?? 'draft'}`;
const readChatMode = (conversationId: string | null): ChatMode => {
  try {
    const stored = localStorage.getItem(CHAT_MODE_STORAGE_KEY(conversationId));
    if (stored === 'chat' || stored === 'build' || stored === 'improve' || stored === 'auto') return stored;
    const globalMode = localStorage.getItem(GLOBAL_CHAT_MODE_STORAGE_KEY);
    if (globalMode === 'chat' || globalMode === 'build' || globalMode === 'improve' || globalMode === 'auto') return globalMode;
    return 'auto';
  } catch { return 'auto'; }
};
const readRememberedConversationId = (): string | null => {
  try {
    const remembered = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
    return remembered && remembered !== DRAFT_CONVERSATION_ID ? remembered : null;
  } catch { return null; }
};

export const ChatView: React.FC<{ personaName: string; onNavigate?: (tab: string) => void }> = ({ personaName, onNavigate }) => {
  const [conversations, setConversations] = useState<any[]>([]);
  const initialConvId = readRememberedConversationId();
  const [activeConvId, setActiveConvId] = useState<string | null>(initialConvId);
  const activeConvIdRef = useRef<string | null>(initialConvId);
  const hasSelectedConversation = useRef(false);
  const [historyVisible, setHistoryVisible] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<ChatMode>(() => readChatMode(initialConvId));
  const [improvement, setImprovement] = useState<ImprovementRun | null>(null);
  const [capabilityFlow, setCapabilityFlow] = useState<CapabilityWorkflow | null>(null);
  const reportedFlows = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const storeMode = (conversationId: string | null, nextMode: ChatMode) => {
    try {
      localStorage.setItem(CHAT_MODE_STORAGE_KEY(conversationId), nextMode);
      localStorage.setItem(GLOBAL_CHAT_MODE_STORAGE_KEY, nextMode);
    } catch { /* Keep the in-memory mode if storage is unavailable. */ }
  };

  const selectConversation = (conversationId: string | null, draftMode?: ChatMode) => {
    activeConvIdRef.current = conversationId;
    hasSelectedConversation.current = true;
    setActiveConvId(conversationId);
    const selectedMode = conversationId === null && draftMode ? draftMode : readChatMode(conversationId);
    setMode(selectedMode);
    storeMode(conversationId, selectedMode);
    try { localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId ?? DRAFT_CONVERSATION_ID); } catch { /* Keep the selected thread in memory if storage is unavailable. */ }
  };

  const changeMode = (nextMode: ChatMode) => {
    setMode(nextMode);
    storeMode(activeConvIdRef.current, nextMode);
  };

  const loadConversations = async () => {
    try {
      const res = await apiFetch<{ conversations: any[] }>('/api/v1/conversations');
      setConversations(res.conversations);
      if (!hasSelectedConversation.current) {
        let rememberedId: string | null = null;
        try { rememberedId = localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY); } catch { /* Fall back to the most recent conversation. */ }
        if (rememberedId === DRAFT_CONVERSATION_ID) selectConversation(null);
        else if (rememberedId && res.conversations.some((conversation) => conversation.id === rememberedId)) selectConversation(rememberedId);
        else if (res.conversations.length > 0) selectConversation(res.conversations[0].id);
        else selectConversation(null);
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

  const deleteConversation = async (conversation: { id: string; title: string }) => {
    if (!window.confirm(`Delete “${conversation.title}” and all its messages? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/v1/conversations/${conversation.id}`, { method: 'DELETE' });
      try { localStorage.removeItem(CHAT_MODE_STORAGE_KEY(conversation.id)); } catch { /* Conversation deletion should succeed if local storage is unavailable. */ }
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (activeConvId === conversation.id) {
        setMessages([]);
        const nextId = remaining[0]?.id ?? null;
        selectConversation(nextId);
        if (nextId) void loadMessages(nextId);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete this chat');
    }
  };

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => {
    const id = localStorage.getItem('tj-capability-workflow');
    if (id) void apiFetch<CapabilityWorkflow>(`/api/v1/chat/capability-workflows/${id}`).then(setCapabilityFlow).catch(() => {});
  }, []);
  useEffect(() => { if (activeConvId) loadMessages(activeConvId); }, [activeConvId]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => {
    if (!improvement || ['completed', 'failed', 'rolled_back'].includes(improvement.state)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await apiFetch<ImprovementRun>(`/api/v1/self-improvement/runs/${improvement.id}`);
        setImprovement(next);
        if (next.state === 'completed') {
          setMessages((prev) => [...prev, { id: `improvement-${next.id}`, role: 'assistant', content: `After your deployment approval, TJ applied: ${next.files.join(', ')}. ${next.checks.length} checks passed. API source changes need a server restart before they are live.` }]);
          setLoading(false);
        } else if (next.state === 'failed' || next.state === 'awaiting_approval') {
          setError(next.error ?? (next.state === 'awaiting_approval' ? 'TJ could not verify this change. Review its rollback request.' : 'TJ could not complete this change.'));
          setLoading(false);
        } else if (next.state === 'awaiting_deployment_approval') {
          setLoading(false);
        } else if (next.state === 'rolled_back') {
          setMessages((prev) => [...prev, { id: `auto-rollback-${next.id}`, role: 'assistant', content: 'After your approval, TJ restored the previous source files.' }]);
          setLoading(false);
        }
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read improvement status'); setLoading(false); }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [improvement?.id, improvement?.state]);
  useEffect(() => {
    if (!capabilityFlow || ['completed', 'denied', 'failed'].includes(capabilityFlow.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await apiFetch<CapabilityWorkflow>(`/api/v1/chat/capability-workflows/${capabilityFlow.approval_id}`);
        setCapabilityFlow(next);
        if (['completed', 'denied', 'failed'].includes(next.status)) localStorage.removeItem('tj-capability-workflow');
        if (next.status === 'completed' && !reportedFlows.current.has(next.approval_id)) {
          reportedFlows.current.add(next.approval_id);
          const result = typeof next.result === 'string' ? next.result : next.result?.content;
          setMessages((prev) => [...prev, { id: `capability-result-${next.approval_id}`, role: 'assistant', content: result || next.message }]);
        }
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read capability status'); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [capabilityFlow?.approval_id, capabilityFlow?.status]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const userText = input;
    const submittedMode = mode;
    setInput('');
    setError(null);
    setLoading(true);
    const responseId = `bot-${Date.now()}`;
    setMessages((prev) => [...prev, { id: `user-${responseId}`, role: 'user', content: userText }, ...(submittedMode === 'improve' ? [] : [{ id: responseId, role: 'assistant' as const, content: '' }])]);

    try {
      if (submittedMode === 'improve') {
        const run = await apiFetch<ImprovementRun>('/api/v1/self-improvement/runs', { method: 'POST', body: JSON.stringify({ prompt: userText }) });
        setImprovement(run);
        return;
      }
      const conversationId = activeConvIdRef.current;
      const res = await apiChatStream<any>({ conversation_id: conversationId ?? undefined, content: userText, mode: submittedMode }, (delta) => {
        setMessages((prev) => prev.map((message) => message.id === responseId ? { ...message, content: message.content + delta } : message));
      });
      if (!conversationId && res.conversation_id) {
        storeMode(res.conversation_id, submittedMode);
        selectConversation(res.conversation_id);
        loadConversations();
      }
      setMessages((prev) => prev.map((message) => message.id === responseId ? { id: res.message?.id ?? responseId, role: 'assistant', content: res.content, trace: res.message?.trace ?? { routed_model_id: res.routed_model_id, routed_via: res.routed_via } } : message));
      if (res.status === 'approval_required' && res.approval_id) {
        localStorage.setItem('tj-capability-workflow', res.approval_id);
        setCapabilityFlow({ approval_id: res.approval_id, status: 'pending_approval', capability_name: res.capability_id ?? 'New ability', reason: res.content, message: res.content });
      }
    } catch (err: any) {
      setMessages((prev) => prev.filter((message) => message.id !== responseId || !!message.content));
      setError(err.message);
      setLoading(false);
    } finally {
      if (submittedMode !== 'improve') setLoading(false);
    }
  };

  return (
    <div className="tj-chat-view" style={{ display: 'flex', height: '100%', gap: 16 }}>
      {/* Threads Sidebar */}
      <div className="tj-chat-sidebar" style={{ width: historyVisible ? 260 : 46, flex: `0 0 ${historyVisible ? 260 : 46}px`, minWidth: 0, background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', padding: historyVisible ? 12 : 6, transition: 'width 160ms ease, flex-basis 160ms ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: historyVisible ? 'space-between' : 'center', gap: 6, marginBottom: historyVisible ? 10 : 0 }}>
          {historyVisible && <button onClick={() => { selectConversation(null, mode); setMessages([]); }} style={{ flex: 1, padding: '8px 9px', background: 'var(--accent-blue)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>+ New Chat</button>}
          <button type="button" onClick={() => setHistoryVisible((visible) => !visible)} aria-label={historyVisible ? 'Hide chat history' : 'Show chat history'} title={historyVisible ? 'Hide chat history' : 'Show chat history'} style={{ display: 'grid', placeItems: 'center', flex: '0 0 30px', width: 30, height: 30, padding: 0, background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-muted)', cursor: 'pointer' }}>
            {historyVisible ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
        {historyVisible && <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {conversations.map((c) => (
            <div key={c.id} onClick={() => selectConversation(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 5px 4px 9px', borderRadius: 6, background: c.id === activeConvId ? 'var(--bg-card-hover)' : 'transparent', cursor: 'pointer', color: c.id === activeConvId ? 'var(--text-main)' : 'var(--text-muted)' }}>
              <span title={c.title} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.82rem' }}>{c.title}</span>
              <button type="button" aria-label={`Delete chat ${c.title}`} title="Delete chat" onClick={(event) => { event.stopPropagation(); void deleteConversation(c); }} style={{ display: 'grid', placeItems: 'center', flex: '0 0 26px', width: 26, height: 26, padding: 0, border: 0, borderRadius: 5, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>}
      </div>

      {/* Main Stream */}
      <div className="tj-chat-stream" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border-subtle)', padding: 16, height: '100%' }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)' }}>
              <Sparkles size={40} style={{ margin: '0 auto 12px', color: 'var(--accent-cyan)' }} />
              <h3>How can {personaName} assist you today?</h3>
              <p style={{ fontSize: '0.85rem', marginTop: 6 }}>Type an instruction in Auto mode to let TJ plan and orchestrate autonomous agents.</p>
            </div>
          )}

          {messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={m.id}
                className="tj-chat-message"
                style={{
                  alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '75%',
                  background: isUser ? 'var(--accent-blue)' : 'var(--bg-card)',
                  color: isUser ? '#fff' : 'var(--text-main)', padding: '12px 16px', borderRadius: 8,
                  border: isUser ? 'none' : '1px solid var(--border-subtle)', whiteSpace: 'pre-wrap', fontSize: '0.9rem', lineHeight: 1.5,
                }}
              >
                {m.content}
                {m.trace?.routed_via && <div style={{ marginTop: 8, color: 'var(--text-dim)', fontSize: '0.7rem', fontFamily: 'JetBrains Mono' }}>Routed via {m.trace.routed_via}</div>}
              </div>
            );
          })}

          {loading && (
            <div style={{ alignSelf: 'flex-start', background: 'var(--bg-card)', padding: '10px 16px', borderRadius: 8, fontSize: '0.85rem', color: 'var(--accent-cyan)', fontStyle: 'italic' }}>
              {mode === 'improve' ? improvement?.stage ?? 'Starting TJ improvement...' : 'Thinking and orchestrating...'}
            </div>
          )}

          {(improvement?.state === 'completed' || improvement?.state === 'awaiting_deployment_approval') && <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 12 }}>
            <strong>{improvement.state === 'completed' ? 'Approved and deployed source diff' : 'Verified candidate · approval required to deploy'}</strong>
            <pre style={{ maxHeight: 340, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }}>{improvement.diff || 'No diff available'}</pre>
            {improvement.state === 'awaiting_deployment_approval' && <><p style={{ color: 'var(--text-muted)', margin: '7px 0' }}>{improvement.checks.length} isolated checks passed. TJ has not changed the application source.</p><button type="button" onClick={() => onNavigate?.('approvals')} style={{ padding: '7px 12px', background: 'var(--accent-amber)', color: '#17120a', border: 0, borderRadius: 6 }}>Review deployment approval</button></>}
            {improvement.state === 'completed' && <button type="button" onClick={async () => {
              try {
                const run = await apiFetch<ImprovementRun>(`/api/v1/self-improvement/runs/${improvement.id}/rollback`, { method: 'POST' });
                setImprovement(run);
                setMessages((prev) => [...prev, { id: `rollback-${run.id}`, role: 'assistant', content: 'TJ restored the original source files.' }]);
              } catch (reason) { setError(reason instanceof Error ? reason.message : 'Rollback failed'); }
            }} style={{ padding: '7px 12px', background: 'transparent', color: 'var(--text-main)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}>Undo this change</button>}
          </div>}
          {improvement?.state === 'awaiting_approval' && <div role="status" style={{ background: 'var(--bg-card)', border: '1px solid var(--accent-amber)', borderRadius: 10, padding: 14 }}><strong>Verification needs your decision</strong><p style={{ color: 'var(--text-muted)', margin: '7px 0' }}>TJ tried a repair. The change still failed a check; it has requested approval before restoring the previous source.</p><button type="button" onClick={() => onNavigate?.('approvals')} style={{ padding: '8px 12px', background: 'var(--accent-amber)', color: '#17120a', border: 0, borderRadius: 6, cursor: 'pointer' }}>Review rollback approval</button></div>}
          {capabilityFlow && <div role="status" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-glow)', borderRadius: 10, padding: 14 }}><strong>{capabilityFlow.capability_name}</strong><p style={{ color: 'var(--text-muted)', margin: '7px 0' }}>{capabilityFlow.message}</p><small style={{ color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>{capabilityFlow.status.replaceAll('_', ' ')}</small>{capabilityFlow.status === 'pending_approval' && <button type="button" onClick={() => onNavigate?.('approvals')} style={{ display: 'block', marginTop: 10, padding: '8px 12px', background: 'var(--accent-cyan)', color: '#061018', border: 0, borderRadius: 6, cursor: 'pointer' }}>Review ability approval</button>}</div>}

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(244, 63, 94, 0.1)', color: '#fb7185', padding: '10px 14px', borderRadius: 6, fontSize: '0.85rem' }}>
              <AlertCircle size={16} /> {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <VoiceControl />
        <form onSubmit={handleSend} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {(['auto', 'chat', 'build', 'improve'] as const).map((m) => (
              <button
                type="button" key={m} aria-pressed={mode === m} onClick={() => changeMode(m)}
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
              placeholder={mode === 'improve' ? 'Tell TJ what to improve in its own source...' : 'Give TJ a task or ask a question...'} disabled={loading}
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
