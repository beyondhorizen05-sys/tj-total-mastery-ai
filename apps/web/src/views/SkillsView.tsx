import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';
import { Search, Sparkles, BookOpen, Copy, Check, Terminal } from 'lucide-react';
import type { Memory } from '@tj/schemas';

type Manifest = {
  id: string;
  version: string;
  description: string;
  input_schema: { properties: Record<string, { type: 'string'; maxLength?: number }>; required: string[] };
  permissions: string[];
  network_access: boolean;
  file_access: boolean;
  os_privileges: boolean;
  execution: { method: string; template: string };
};

type Skill = { manifest: Manifest; digest: string; enabled: boolean; reviewed_at: string | null };
type CatalogEntry = { filename: string; manifest?: Manifest; error?: string };
type SkillRun = { id: string; skill_id: string; status: string; timestamp: string; error?: string };

const box: React.CSSProperties = {
  padding: 16,
  border: '1px solid var(--border-subtle)',
  borderRadius: 10,
  background: 'var(--bg-secondary)',
};

const button: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-card)',
  color: 'var(--text-main)',
  cursor: 'pointer',
};

const POPULAR_SKILL_QUERIES = [
  'LangGraph',
  'RAG Engineer',
  'AI Agents Architect',
  'API Security',
  'FastAPI',
  'Docker',
  'Playwright',
  'Database Design',
];

export const SkillsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'universal' | 'declarative'>('universal');

  // Declarative skills state
  const [skills, setSkills] = useState<Skill[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [runs, setRuns] = useState<SkillRun[]>([]);
  const [manifestText, setManifestText] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Universal skills knowledge state
  const [universalQuery, setUniversalQuery] = useState('LangGraph');
  const [universalHits, setUniversalHits] = useState<Array<{ memory: Memory; matched_by: string[] }>>([]);
  const [universalSearching, setUniversalSearching] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadDeclarative = async () => {
    const [installed, discovered, history] = await Promise.all([
      apiFetch<{ skills: Skill[] }>('/api/v1/skills'),
      apiFetch<{ catalog: CatalogEntry[] }>('/api/v1/skills/catalog'),
      apiFetch<{ runs: SkillRun[] }>('/api/v1/skills/runs'),
    ]);
    setSkills(installed.skills);
    setCatalog(discovered.catalog);
    setRuns(history.runs);
  };

  const searchUniversalSkills = async (q: string) => {
    if (!q.trim()) return;
    setUniversalSearching(true);
    try {
      const res = await apiFetch<{ results: Array<{ memory: Memory; matched_by: string[] }> }>(
        `/api/v1/memory/search?q=${encodeURIComponent(q.trim())}&limit=12`,
      );
      // Filter hits to agent skill memories if any, or general hits
      setUniversalHits(res.results || []);
    } catch (e: any) {
      setError(e.message ?? 'Search failed');
    } finally {
      setUniversalSearching(false);
    }
  };

  useEffect(() => {
    void loadDeclarative().catch((e) => setError(e.message));
    void searchUniversalSkills(universalQuery);
  }, []);

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await loadDeclarative();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const selected = skills.find((skill) => skill.manifest.id === selectedId);

  const install = (manifest: unknown) =>
    act(async () => {
      const result = await apiFetch<{ skill: Skill }>('/api/v1/skills', {
        method: 'POST',
        body: JSON.stringify(manifest),
      });
      setSelectedId(result.skill.manifest.id);
      setNotice(`${result.skill.manifest.id} installed disabled. Review its scope before enabling.`);
    });

  const run = () =>
    selected &&
    act(async () => {
      const result = await apiFetch<{ output: { text: string } }>(
        `/api/v1/skills/${encodeURIComponent(selected.manifest.id)}/run`,
        { method: 'POST', body: JSON.stringify({ input: inputs }) },
      );
      setOutput(result.output.text);
      setNotice('Skill completed.');
    });

  const copyToClipboard = (text: string, id: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20, color: 'var(--text-main)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={22} style={{ color: 'var(--accent-cyan)' }} /> Agent Skills & Knowledge Center
          </h2>
          <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            874+ universal agentic playbooks indexed in TJ's hybrid knowledge base, plus local declarative templates.
          </p>
        </div>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--bg-secondary)', padding: 4, borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <button
            onClick={() => setActiveTab('universal')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'universal' ? 'var(--border-strong)' : 'transparent',
              color: activeTab === 'universal' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <BookOpen size={15} /> Universal Skills (874)
          </button>
          <button
            onClick={() => setActiveTab('declarative')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: activeTab === 'declarative' ? 'var(--border-strong)' : 'transparent',
              color: activeTab === 'declarative' ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Terminal size={15} /> Declarative Playbooks
          </button>
        </div>
      </div>

      {error && <p role="alert" style={{ color: '#fb7185', margin: '8px 0' }}>{error}</p>}
      {notice && <p role="status" style={{ color: 'var(--accent-cyan)', margin: '8px 0' }}>{notice}</p>}

      {activeTab === 'universal' ? (
        <div>
          {/* Search Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchUniversalSkills(universalQuery);
            }}
            style={{ display: 'flex', gap: 8, margin: '16px 0 12px 0', maxWidth: 850 }}
          >
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--text-muted)' }} />
              <input
                type="text"
                value={universalQuery}
                onChange={(e) => setUniversalQuery(e.target.value)}
                placeholder="Search 874 skills: e.g. LangGraph, RAG, Playwright, React, FastAPI, Architecture..."
                style={{
                  width: '100%',
                  padding: '10px 14px 10px 38px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 6,
                  color: 'var(--text-main)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
            </div>
            <button
              type="submit"
              disabled={universalSearching}
              style={{
                padding: '0 18px',
                background: 'var(--border-strong)',
                border: 'none',
                borderRadius: 6,
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {universalSearching ? 'Searching...' : 'Search'}
            </button>
          </form>

          {/* Quick Query Pills */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', alignSelf: 'center', marginRight: 4 }}>Popular:</span>
            {POPULAR_SKILL_QUERIES.map((pill) => (
              <button
                key={pill}
                onClick={() => {
                  setUniversalQuery(pill);
                  void searchUniversalSkills(pill);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 14,
                  fontSize: '0.78rem',
                  border: '1px solid var(--border-subtle)',
                  background: universalQuery.toLowerCase() === pill.toLowerCase() ? 'var(--border-strong)' : 'var(--bg-card)',
                  color: 'var(--text-main)',
                  cursor: 'pointer',
                }}
              >
                {pill}
              </button>
            ))}
          </div>

          {/* Knowledge Hits Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
            {universalHits.map((hit) => {
              const prov = (hit.memory.provenance as Record<string, any>) || {};
              const sourceFile = typeof hit.memory.source === 'string' ? hit.memory.source.replace(/^file:skills\//, '') : '';
              const section = typeof prov.section_title === 'string' ? prov.section_title : undefined;

              return (
                <div
                  key={hit.memory.id}
                  style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(56, 189, 248, 0.15)',
                          color: 'var(--accent-cyan)',
                        }}
                      >
                        {sourceFile.replace(/\/SKILL\.md$/, '') || hit.memory.type}
                      </span>
                      <button
                        onClick={() => copyToClipboard(hit.memory.content, hit.memory.id)}
                        title="Copy Playbook Guidance"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: copiedId === hit.memory.id ? '#4ade80' : 'var(--text-muted)',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.75rem',
                        }}
                      >
                        {copiedId === hit.memory.id ? <Check size={14} /> : <Copy size={14} />}
                        {copiedId === hit.memory.id ? 'Copied' : 'Copy'}
                      </button>
                    </div>

                    {section && (
                      <h4 style={{ margin: '0 0 6px 0', fontSize: '0.9rem', color: '#fff' }}>{section}</h4>
                    )}

                    <div
                      style={{
                        fontSize: '0.82rem',
                        color: 'var(--text-main)',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 180,
                        overflowY: 'auto',
                        background: 'rgba(0, 0, 0, 0.2)',
                        padding: 8,
                        borderRadius: 6,
                        fontFamily: 'monospace',
                      }}
                    >
                      {hit.memory.content}
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    <span>Source: {sourceFile || 'memory'}</span>
                    <span>Confidence: {(hit.memory.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          {universalHits.length === 0 && !universalSearching && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              <BookOpen size={32} style={{ marginBottom: 8, opacity: 0.5 }} />
              <p>No matching playbooks found. Try searching for a framework, pattern, or tool name.</p>
            </div>
          )}
        </div>
      ) : (
        /* Declarative Skills View (Original) */
        <div style={{ marginTop: 16 }}>
          <button style={button} disabled={busy} onClick={() => void act(async () => { setNotice('Catalog refreshed.'); })}>
            Refresh
          </button>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) minmax(300px, 2fr)', gap: 16, marginTop: 16 }}>
            <section style={box}>
              <h3>Installed</h3>
              {skills.length === 0 && <p>No skills installed.</p>}
              {skills.map((skill) => (
                <button
                  key={skill.manifest.id}
                  style={{
                    ...button,
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 8,
                    borderColor: selectedId === skill.manifest.id ? 'var(--accent-cyan)' : 'var(--border-subtle)',
                  }}
                  onClick={() => {
                    setSelectedId(skill.manifest.id);
                    setInputs({});
                    setOutput('');
                  }}
                >
                  <strong>{skill.manifest.id}</strong> v{skill.manifest.version}
                  <br />
                  <small>{skill.enabled ? 'Enabled' : 'Disabled'} · {skill.manifest.description}</small>
                </button>
              ))}
              <h3>Local catalog</h3>
              {catalog.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No JSON manifests in the local catalog.</p>}
              {catalog.map((entry) => (
                <div key={entry.filename} style={{ marginBottom: 12 }}>
                  <div>{entry.manifest?.id ?? entry.filename}</div>
                  {entry.error ? (
                    <small style={{ color: '#fb7185' }}>{entry.error}</small>
                  ) : (
                    <button
                      style={button}
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const result = await apiFetch<{ skill: Skill }>('/api/v1/skills/install-from-catalog', {
                            method: 'POST',
                            body: JSON.stringify({ filename: entry.filename }),
                          });
                          setSelectedId(result.skill.manifest.id);
                          setNotice('Installed disabled. Review before enabling.');
                        })
                      }
                    >
                      Install disabled
                    </button>
                  )}
                </div>
              ))}
            </section>
            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              {selected && (
                <section style={box}>
                  <h3>{selected.manifest.id} · v{selected.manifest.version}</h3>
                  <p>{selected.manifest.description}</p>
                  <p>
                    Execution: {selected.manifest.execution.method} · Permissions:{' '}
                    {selected.manifest.permissions.length ? selected.manifest.permissions.join(', ') : 'none'} · Network:{' '}
                    {String(selected.manifest.network_access)} · Files: {String(selected.manifest.file_access)} · OS:{' '}
                    {String(selected.manifest.os_privileges)}
                  </p>
                  <details>
                    <summary>Review template</summary>
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{selected.manifest.execution.template}</pre>
                  </details>
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      style={button}
                      disabled={busy || selected.enabled}
                      onClick={() =>
                        void act(async () => {
                          await apiFetch(`/api/v1/skills/${encodeURIComponent(selected.manifest.id)}/enable`, {
                            method: 'POST',
                            body: JSON.stringify({ reviewed: true }),
                          });
                          setNotice('Skill enabled after review.');
                        })
                      }
                    >
                      I reviewed scope · Enable
                    </button>
                    <button
                      style={button}
                      disabled={busy || !selected.enabled}
                      onClick={() =>
                        void act(async () => {
                          await apiFetch(`/api/v1/skills/${encodeURIComponent(selected.manifest.id)}/disable`, {
                            method: 'POST',
                          });
                          setNotice('Skill disabled.');
                        })
                      }
                    >
                      Disable
                    </button>
                  </div>
                  <h4>Run</h4>
                  {Object.entries(selected.manifest.input_schema.properties).map(([key, spec]) => (
                    <label key={key} style={{ display: 'block', marginBottom: 10 }}>
                      {key}
                      {selected.manifest.input_schema.required.includes(key) ? ' *' : ''}
                      <input
                        style={{
                          display: 'block',
                          width: '100%',
                          marginTop: 4,
                          padding: 8,
                          background: 'var(--bg-card)',
                          color: 'var(--text-main)',
                          border: '1px solid var(--border-subtle)',
                        }}
                        value={inputs[key] ?? ''}
                        maxLength={spec.maxLength ?? 4096}
                        onChange={(e) => setInputs((prior) => ({ ...prior, [key]: e.target.value }))}
                      />
                    </label>
                  ))}
                  <button style={button} disabled={busy || !selected.enabled} onClick={run}>
                    Run skill
                  </button>
                  {output && <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{output}</pre>}
                </section>
              )}
              <section style={box}>
                <h3>Install manifest JSON</h3>
                <textarea
                  aria-label="Skill manifest JSON"
                  value={manifestText}
                  onChange={(e) => setManifestText(e.target.value)}
                  rows={9}
                  style={{ width: '100%', background: 'var(--bg-card)', color: 'var(--text-main)', border: '1px solid var(--border-subtle)' }}
                />
                <button
                  style={button}
                  disabled={busy || !manifestText.trim()}
                  onClick={() => {
                    try {
                      void install(JSON.parse(manifestText));
                    } catch {
                      setError('Manifest must be valid JSON');
                    }
                  }}
                >
                  Validate and install disabled
                </button>
              </section>
              <section style={box}>
                <h3>Recent runs</h3>
                {runs.slice(0, 15).map((item) => (
                  <div key={item.id}>
                    {item.timestamp} · {item.skill_id} · {item.status}
                    {item.error ? ` · ${item.error}` : ''}
                  </div>
                ))}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
