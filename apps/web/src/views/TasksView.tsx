import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Badge } from '../components/Badges';
import { CheckCircle2, Clock, AlertTriangle, Play, RefreshCw, Filter } from 'lucide-react';
import type { Task } from '@tj/schemas';

export const TasksView: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'failed' | 'queued'>('all');
  const [loading, setLoading] = useState(true);

  const loadTasks = async () => {
    try {
      const res = await apiFetch<{ tasks: Task[] }>('/api/v1/tasks');
      setTasks(res.tasks ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
    const timer = setInterval(loadTasks, 4000);
    return () => clearInterval(timer);
  }, []);

  const filtered = tasks.filter((t) => filter === 'all' || t.status === filter);

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Task Execution Queue</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
            Live status of autonomous tasks across agents and workflows
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: 'var(--bg-secondary)', borderRadius: 6, padding: 2, border: '1px solid var(--border-subtle)' }}>
            {(['all', 'running', 'queued', 'completed', 'failed'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setFilter(st)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: 'none',
                  background: filter === st ? 'var(--bg-card-hover)' : 'transparent',
                  color: filter === st ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {st}
              </button>
            ))}
          </div>
          <button
            onClick={loadTasks}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 6,
              background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-main)',
              fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 8, color: 'var(--text-muted)' }}>
            No tasks found matching filter.
          </div>
        ) : (
          filtered.map((t) => (
            <div
              key={t.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px',
                background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {t.status === 'completed' && <CheckCircle2 size={18} color="var(--accent-emerald)" />}
                {t.status === 'running' && <Play size={18} color="var(--accent-cyan)" />}
                {t.status === 'failed' && <AlertTriangle size={18} color="var(--accent-rose)" />}
                {(t.status === 'queued' || t.status === 'waiting') && <Clock size={18} color="var(--accent-amber)" />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.title}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t.description || 'No description'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Badge variant={t.risk === 'high' ? 'danger' : t.risk === 'medium' ? 'warning' : 'neutral'}>
                  {t.risk}
                </Badge>
                <Badge variant={t.status === 'completed' ? 'success' : t.status === 'running' ? 'accent' : t.status === 'failed' ? 'danger' : 'neutral'}>
                  {t.status}
                </Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
