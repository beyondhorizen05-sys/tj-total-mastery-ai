import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Badge } from '../components/Badges';
import { Terminal, Shield, Zap } from 'lucide-react';
import { EVENT_NAMES, type TJEvent } from '@tj/schemas';

export const ActivityView: React.FC = () => {
  const [events, setEvents] = useState<TJEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<{ events: TJEvent[] }>('/api/v1/system/activity?limit=100')
      .then((result) => { if (alive) setEvents((current) => [...current, ...result.events.filter((event) => !current.some((item) => item.id === event.id))].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 100)); })
      .catch((reason) => { if (alive) setError(reason.message ?? 'Could not load activity history'); });
    const stream = new EventSource('/api/v1/system/events');
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    const receive = (message: MessageEvent) => {
      try {
        const event = JSON.parse(message.data) as TJEvent;
        setEvents((current) => [event, ...current.filter((item) => item.id !== event.id)].slice(0, 100));
      } catch { setError('An activity event could not be read'); }
    };
    for (const name of EVENT_NAMES) stream.addEventListener(name, receive as EventListener);
    return () => { alive = false; stream.close(); };
  }, []);

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>System Activity Stream</h2>
          <Badge variant={connected ? 'success' : 'danger'}>{connected ? 'LIVE SSE' : 'DISCONNECTED'}</Badge>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 0' }}>Persisted history and live agent, tool, memory, and approval events.</p>
      </div>
      {error && <p role="alert" style={{ color: '#fb7185' }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.length === 0 ? <div style={{ padding: 40, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 8, color: 'var(--text-muted)' }}>No activity has been recorded yet.</div> : events.map((event) => (
          <div key={event.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border-subtle)', fontFamily: 'monospace', fontSize: '0.8rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {event.severity === 'warning' ? <Zap size={14} color="var(--accent-amber)" /> : event.severity === 'error' || event.severity === 'critical' ? <Shield size={14} color="var(--accent-rose)" /> : <Terminal size={14} color="var(--accent-cyan)" />}
              <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>{event.name}</span>
              <span style={{ color: 'var(--text-main)' }}>{event.summary}</span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>{new Date(event.ts).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
