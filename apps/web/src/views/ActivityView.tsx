import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Badge } from '../components/Badges';
import { Radio, RefreshCw, Terminal, Shield, Zap } from 'lucide-react';

interface ActivityItem {
  id: string;
  name: string;
  severity: 'debug' | 'info' | 'warning' | 'error';
  summary: string;
  created_at: string;
}

export const ActivityView: React.FC = () => {
  const [events, setEvents] = useState<ActivityItem[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Connect to SSE live event stream
    const evtSource = new EventSource('/api/v1/system/events');

    evtSource.onopen = () => {
      setConnected(true);
    };

    evtSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents((prev) => [
          {
            id: parsed.id || Math.random().toString(),
            name: parsed.name || 'system.event',
            severity: parsed.severity || 'info',
            summary: parsed.summary || JSON.stringify(parsed),
            created_at: parsed.created_at || new Date().toISOString(),
          },
          ...prev.slice(0, 99),
        ]);
      } catch (err) {
        console.error('Failed to parse SSE event', err);
      }
    };

    evtSource.onerror = () => {
      setConnected(false);
    };

    return () => {
      evtSource.close();
    };
  }, []);

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>System Activity Stream</h2>
            <Badge variant={connected ? 'success' : 'danger'}>
              {connected ? 'LIVE SSE' : 'DISCONNECTED'}
            </Badge>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
            Real-time SSE event feed: agent thoughts, tool dispatches, memory writes, and approval triggers
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 8, color: 'var(--text-muted)' }}>
            Listening for live system events...
          </div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px',
                background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border-subtle)',
                fontFamily: 'monospace', fontSize: '0.8rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {ev.severity === 'warning' ? (
                  <Zap size={14} color="var(--accent-amber)" />
                ) : ev.severity === 'error' ? (
                  <Shield size={14} color="var(--accent-rose)" />
                ) : (
                  <Terminal size={14} color="var(--accent-cyan)" />
                )}
                <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>{ev.name}</span>
                <span style={{ color: 'var(--text-main)' }}>{ev.summary}</span>
              </div>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                {new Date(ev.created_at).toLocaleTimeString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
