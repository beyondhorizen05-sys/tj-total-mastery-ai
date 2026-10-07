import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Play, Pause, XCircle } from 'lucide-react';

export const WorkflowsView: React.FC = () => {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);

  const load = () => {
    apiFetch<{ workflows: any[] }>('/api/v1/workflows').then((r) => setWorkflows(r.workflows));
    apiFetch<{ runs: any[] }>('/api/v1/workflow-runs').then((r) => setRuns(r.runs));
  };

  useEffect(() => { load(); }, []);

  const handleRun = async (id: string) => {
    try {
      await apiFetch(`/api/v1/workflows/${id}/run`, { method: 'POST' });
      load();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>Workflows & DAG Automation</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Deterministic DAG workflows with parallel execution, durable checkpointing, and partial error recovery.
      </p>

      <h3 style={{ marginBottom: 12 }}>Saved Workflows ({workflows.length})</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginBottom: 32 }}>
        {workflows.map((w) => (
          <div key={w.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: 4 }}>{w.name}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>{w.description || 'No description'}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)' }}>{w.steps?.length ?? 0} Steps</span>
              <button
                onClick={() => handleRun(w.id)}
                style={{ padding: '6px 14px', background: 'var(--accent-blue)', border: 'none', borderRadius: 4, color: '#fff', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Play size={14} /> Run
              </button>
            </div>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Recent Executions</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {runs.map((r) => (
          <div key={r.id} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
            <div>
              <span style={{ fontWeight: 600 }}>Run {r.id.slice(0, 8)}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({r.workflow_id})</span>
            </div>
            <span style={{ fontWeight: 700, color: r.status === 'completed' ? '#34d399' : r.status === 'running' ? '#fbbf24' : '#fb7185', textTransform: 'uppercase' }}>
              {r.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
