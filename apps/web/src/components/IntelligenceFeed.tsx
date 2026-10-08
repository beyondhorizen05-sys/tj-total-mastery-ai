import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Radio } from 'lucide-react';
import { EVENT_NAMES, type TJEvent, type SystemStatus } from '@tj/schemas';

interface IntelligenceFeedProps {
  status: SystemStatus | null;
  onNavigate: (tab: string) => void;
}

export const IntelligenceFeed: React.FC<IntelligenceFeedProps> = ({ status, onNavigate }) => {
  const [events, setEvents] = useState<TJEvent[]>([]);
  const [filter, setFilter] = useState<'all' | 'warning' | 'audit'>('all');
  const [connected, setConnected] = useState(false);

  const loadEvents = async () => {
    try {
      const res = await apiFetch<{ events: TJEvent[] }>('/api/v1/system/activity?limit=30');
      setEvents(res.events ?? []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadEvents();
    const timer = setInterval(loadEvents, 30000);
    const stream = new EventSource('/api/v1/system/events');
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    const receive = (message: MessageEvent) => {
      try {
        const event = JSON.parse(message.data) as TJEvent;
        setEvents((previous) => [event, ...previous.filter((item) => item.id !== event.id)].slice(0, 30));
      } catch { /* skip malformed event */ }
    };
    for (const name of EVENT_NAMES) stream.addEventListener(name, receive as EventListener);
    return () => { clearInterval(timer); stream.close(); };
  }, []);

  const filteredEvents = events.filter((e) => {
    if (filter === 'warning') return e.severity === 'warning' || e.severity === 'error';
    if (filter === 'audit') return e.name.startsWith('approval') || e.name.startsWith('security');
    return true;
  });

  return (
    <aside className="tj-intelligence-feed" style={{
      width: 300, height: '100%', display: 'flex', flexDirection: 'column',
      background: 'rgba(7, 13, 26, 0.75)', backdropFilter: 'blur(16px)',
      borderRight: '1px solid var(--border-subtle)', overflow: 'hidden',
    }}>
      {/* Panel Header */}
      <div onClick={() => onNavigate('activity')} title="Open Activity" style={{
        padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Radio size={14} color="var(--accent-cyan)" />
          <span style={{ fontFamily: 'JetBrains Mono', fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.1em', color: '#fff' }}>
            INTELLIGENCE FEED
          </span>
        </div>
        <span style={{ fontSize: '0.65rem', fontFamily: 'JetBrains Mono', color: 'var(--text-muted)' }}>
          {connected ? 'LIVE SSE' : 'REFRESHING'}
        </span>
      </div>

      {/* Filter Chips */}
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid rgba(30, 58, 102, 0.3)' }}>
        {(['all', 'warning', 'audit'] as const).map((f) => (
          <button
            key={f} onClick={() => setFilter(f)}
            style={{
              flex: 1, padding: '4px 6px', fontSize: '0.68rem', fontFamily: 'JetBrains Mono',
              textTransform: 'uppercase', borderRadius: 4, border: '1px solid',
              borderColor: filter === f ? 'var(--accent-cyan)' : 'var(--border-subtle)',
              background: filter === f ? 'rgba(0, 242, 254, 0.15)' : 'transparent',
              color: filter === f ? 'var(--accent-cyan)' : 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Stream list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {filteredEvents.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
            No recent telemetry events recorded.
          </div>
        ) : (
          filteredEvents.map((ev) => {
            const isWarn = ev.severity === 'warning' || ev.severity === 'error';
            return (
              <div
                key={ev.id}
                style={{
                  padding: '8px 10px', borderRadius: 6,
                  background: isWarn ? 'rgba(244, 63, 94, 0.08)' : 'rgba(12, 22, 42, 0.6)',
                  border: `1px solid ${isWarn ? 'rgba(244, 63, 94, 0.3)' : 'var(--border-subtle)'}`,
                  fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontFamily: 'JetBrains Mono', fontSize: '0.65rem', fontWeight: 700,
                    color: isWarn ? 'var(--accent-rose)' : 'var(--accent-cyan)',
                  }}>
                    {ev.name}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono' }}>
                    {new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div style={{ color: 'var(--text-main)', fontSize: '0.75rem', lineHeight: 1.3 }}>
                  {ev.summary}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Telemetry Summary footer */}
      <div style={{
        padding: '10px 12px', borderTop: '1px solid var(--border-subtle)',
        background: 'rgba(5, 10, 22, 0.9)', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span>DATABASE:</span>
          <span style={{ color: status?.components.find((component) => component.component === 'database')?.state === 'healthy' ? 'var(--accent-emerald)' : 'var(--accent-amber)', fontFamily: 'JetBrains Mono' }}>{status?.components.find((component) => component.component === 'database')?.detail ?? 'UNKNOWN'}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span>SECURITY LEVEL:</span>
          <span style={{ color: 'var(--accent-cyan)', fontFamily: 'JetBrains Mono' }}>{status?.security_state ?? 'DENY-BY-DEFAULT'}</span>
        </div>
      </div>
    </aside>
  );
};
