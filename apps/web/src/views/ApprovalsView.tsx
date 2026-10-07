import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export const ApprovalsView: React.FC = () => {
  const [approvals, setApprovals] = useState<any[]>([]);

  const load = () => {
    apiFetch<{ approvals: any[] }>('/api/v1/approvals')
      .then((res) => setApprovals(res.approvals))
      .catch(console.error);
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleDecide = async (id: string, decision: 'approve_once' | 'deny') => {
    try {
      await apiFetch(`/api/v1/approvals/${id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      load();
    } catch (e) {
      console.error(e);
    }
  };

  const pending = approvals.filter((a) => a.status === 'pending');
  const history = approvals.filter((a) => a.status !== 'pending');

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginBottom: 8 }}>High-Stakes Action Gate</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: '0.9rem' }}>
        Human-in-the-loop permission approvals for high-risk tools, shell execution, and irreversible operations.
      </p>

      <h3 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <AlertTriangle size={18} color="#fbbf24" /> Pending Approvals ({pending.length})
      </h3>

      {pending.length === 0 ? (
        <div style={{ padding: 24, background: 'var(--bg-secondary)', borderRadius: 8, color: 'var(--text-muted)', marginBottom: 32 }}>
          No actions currently awaiting approval. TJ is operating within authorized policy limits.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
          {pending.map((a) => (
            <div
              key={a.id}
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid #fbbf24',
                borderRadius: 8,
                padding: 16,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>{a.action}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>Target: {a.target}</div>
                <div style={{ fontSize: '0.85rem', color: '#fbbf24', marginTop: 4 }}>Why: {a.why}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleDecide(a.id, 'approve_once')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    background: 'var(--accent-emerald)',
                    border: 'none',
                    borderRadius: 6,
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <CheckCircle size={16} /> Approve
                </button>
                <button
                  onClick={() => handleDecide(a.id, 'deny')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    background: 'var(--accent-rose)',
                    border: 'none',
                    borderRadius: 6,
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <XCircle size={16} /> Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h3 style={{ marginBottom: 12 }}>Decision History</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {history.slice(0, 20).map((a) => (
          <div
            key={a.id}
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 6,
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.85rem',
            }}
          >
            <div>
              <span style={{ fontWeight: 600 }}>{a.action}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>({a.target})</span>
            </div>
            <span
              style={{
                fontWeight: 700,
                color: a.status === 'approved' ? '#34d399' : '#fb7185',
                textTransform: 'uppercase',
              }}
            >
              {a.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
