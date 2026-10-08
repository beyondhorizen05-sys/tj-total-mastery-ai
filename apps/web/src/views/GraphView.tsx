import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../api';

type NodeType = 'project' | 'agent' | 'task' | 'memory' | 'conversation' | 'artifact' | 'event';
type GraphNode = { id: string; type: NodeType; label: string; description: string; created_at: string; source: string; metadata: Record<string, string | number | boolean | null> };
type GraphEdge = { id: string; from: string; to: string; relation: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; limits: { max_nodes: number; max_edges: number; truncated: boolean }; project_id: string | null };

const order: NodeType[] = ['project', 'agent', 'task', 'memory', 'conversation', 'artifact', 'event'];
const colors: Record<NodeType, string> = { project: '#a78bfa', agent: '#38bdf8', task: '#fbbf24', memory: '#34d399', conversation: '#f472b6', artifact: '#fb923c', event: '#94a3b8' };
const empty: GraphData = { nodes: [], edges: [], limits: { max_nodes: 200, max_edges: 400, truncated: false }, project_id: null };

export const GraphView: React.FC = () => {
  const [graph, setGraph] = useState<GraphData>(empty);
  const [projects, setProjects] = useState<GraphNode[]>([]);
  const [projectId, setProjectId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [zoom, setZoom] = useState(0.75);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    apiFetch<GraphData>(`/api/v1/graph${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`)
      .then((result) => {
        if (!alive) return;
        setGraph(result);
        if (!projectId) setProjects(result.nodes.filter((node) => node.type === 'project'));
        setSelectedId((current) => result.nodes.some((node) => node.id === current) ? current : '');
        setError('');
      })
      .catch((reason) => { if (alive) setError((reason as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const layout = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    let maxRows = 0;
    for (const [column, type] of order.entries()) {
      const group = graph.nodes.filter((node) => node.type === type);
      maxRows = Math.max(maxRows, group.length);
      group.forEach((node, row) => positions.set(node.id, { x: 120 + column * 230, y: 110 + row * 72 }));
    }
    return { positions, width: 1640, height: Math.max(650, 170 + maxRows * 72) };
  }, [graph]);

  const selected = graph.nodes.find((node) => node.id === selectedId);
  const relations = selected ? graph.edges.filter((edge) => edge.from === selected.id || edge.to === selected.id) : [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const matching = (node: GraphNode) => !query || `${node.label} ${node.type}`.toLowerCase().includes(query.toLowerCase());

  return <div style={{ padding: 24, height: '100%', overflowY: 'auto', display: 'grid', gap: 16, alignContent: 'start' }}>
    <header><h2 style={{ margin: 0 }}>Knowledge Graph</h2>
      <p style={{ color: 'var(--text-muted)' }}>Explicit links from saved projects, agents, tasks, memories, conversations, artifacts, and events. No inferred relationships are shown.</p>
    </header>
    {error && <p role="alert" style={{ color: '#fb7185' }}>{error}</p>}
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <label>Project <select value={projectId} onChange={(event) => setProjectId(event.target.value)} style={{ marginLeft: 8, padding: 8, color: 'var(--text-main)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}>
        <option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id.slice('project:'.length)}>{project.label}</option>)}
      </select></label>
      <input aria-label="Find graph node" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a node" style={{ padding: 8, color: 'var(--text-main)', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }} />
      <label>Zoom <input type="range" min="0.5" max="1.5" step="0.1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <span style={{ color: 'var(--text-muted)' }}>{loading ? 'Loading…' : `${graph.nodes.length} nodes · ${graph.edges.length} links`}</span>
      {graph.limits.truncated && <span style={{ color: '#fbbf24' }}>Showing a bounded recent subset</span>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 320px)', gap: 16, minHeight: 500 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10, overflow: 'auto', maxHeight: '70vh' }}>
        {graph.nodes.length === 0 ? <p style={{ padding: 24, color: 'var(--text-muted)' }}>No persisted graph records are available for this scope.</p> :
          <svg width={layout.width * zoom} height={layout.height * zoom} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Knowledge graph visualization. Use the node list below to inspect a record.">
            {order.map((type, index) => <text key={type} x={120 + index * 230} y={42} textAnchor="middle" fill={colors[type]} fontSize="16" fontWeight="700">{type.toUpperCase()}</text>)}
            {graph.edges.map((edge) => {
              const from = layout.positions.get(edge.from); const to = layout.positions.get(edge.to);
              return from && to ? <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={selectedId && (edge.from === selectedId || edge.to === selectedId) ? '#e2e8f0' : '#475569'} strokeWidth={selectedId && (edge.from === selectedId || edge.to === selectedId) ? 2 : 1} opacity={selectedId && edge.from !== selectedId && edge.to !== selectedId ? 0.16 : 0.5} /> : null;
            })}
            {graph.nodes.map((node) => {
              const pos = layout.positions.get(node.id)!;
              const muted = !matching(node);
              return <g key={node.id} aria-hidden="true" onClick={() => setSelectedId(node.id)} style={{ cursor: 'pointer', opacity: muted ? 0.2 : 1 }}>
                <circle cx={pos.x} cy={pos.y} r={selectedId === node.id ? 18 : 13} fill={colors[node.type]} stroke={selectedId === node.id ? '#fff' : 'none'} strokeWidth={2} />
                <text x={pos.x + 23} y={pos.y + 5} fill="var(--text-main)" fontSize="13">{node.label.slice(0, 23)}</text>
              </g>;
            })}
          </svg>}
        {graph.nodes.length > 0 && <section aria-label="Knowledge graph nodes" style={{ padding: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Nodes · select a record to inspect its relationships</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {graph.nodes.filter(matching).map((node) => <button key={node.id} type="button" aria-pressed={selectedId === node.id} onClick={() => setSelectedId(node.id)} style={{ padding: '6px 9px', borderRadius: 6, border: `1px solid ${selectedId === node.id ? colors[node.type] : 'var(--border-subtle)'}`, color: 'var(--text-main)', background: 'var(--bg-main)', cursor: 'pointer' }}>
              <span style={{ color: colors[node.type] }}>{node.type}</span> · {node.label}
            </button>)}
            {graph.nodes.every((node) => !matching(node)) && <span style={{ color: 'var(--text-muted)' }}>No matching nodes.</span>}
          </div>
        </section>}
      </div>
      <aside style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 16, alignSelf: 'start' }}>
        {selected ? <>
          <div style={{ color: colors[selected.type], fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}>{selected.type}</div>
          <h3 style={{ overflowWrap: 'anywhere' }}>{selected.label}</h3>
          <p style={{ overflowWrap: 'anywhere' }}>{selected.description || 'No description saved.'}</p>
          <dl style={{ fontSize: 13 }}><dt>Source</dt><dd style={{ marginLeft: 0 }}>{selected.source}</dd><dt>Created</dt><dd style={{ marginLeft: 0 }}>{new Date(selected.created_at).toLocaleString()}</dd>
            {Object.entries(selected.metadata).map(([name, value]) => <React.Fragment key={name}><dt>{name}</dt><dd style={{ marginLeft: 0, overflowWrap: 'anywhere' }}>{String(value ?? '—')}</dd></React.Fragment>)}
          </dl>
          <h4>Relationships ({relations.length})</h4>
          {relations.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No visible links in this bounded graph.</p>}
          {relations.map((edge) => {
            const other = nodeById.get(edge.from === selected.id ? edge.to : edge.from);
            return other && <button key={edge.id} onClick={() => setSelectedId(other.id)} style={{ display: 'block', width: '100%', marginBottom: 7, padding: 8, textAlign: 'left', color: 'var(--text-main)', background: 'var(--bg-main)', border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: 'pointer' }}>
              {edge.relation} → {other.type}: {other.label}
            </button>;
          })}
        </> : <p style={{ color: 'var(--text-muted)' }}>Select a node to inspect its source, timestamp, saved details, and visible relationships.</p>}
      </aside>
    </div>
  </div>;
};
