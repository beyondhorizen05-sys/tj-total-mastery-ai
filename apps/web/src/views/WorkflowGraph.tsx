import React from 'react';
import type { Workflow, WorkflowRun } from '@tj/schemas';
import './workflow-graph.css';

interface Props {
  workflow: Workflow;
  run?: WorkflowRun;
  onSelectStep?: (stepId: string) => void;
  editable?: boolean;
  selectedStepId?: string;
}

const kindIcon: Record<string, string> = { model: '✧', agent: '◇', tool: '⌘', connector: '↗', approval: '✓', wait: '◷', transform: '{ }' };

export const WorkflowGraph: React.FC<Props> = ({ workflow, run, onSelectStep, editable = false, selectedStepId }) => {
  const depths = new Map<string, number>();
  const getDepth = (id: string, visiting = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0;
    const step = workflow.steps.find((item) => item.id === id);
    if (!step || !step.depends_on.length) { depths.set(id, 0); return 0; }
    visiting.add(id);
    const depth = Math.max(...step.depends_on.map((dependency) => getDepth(dependency, visiting))) + 1;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  workflow.steps.forEach((step) => getDepth(step.id));
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  workflow.steps.forEach((step) => {
    const depth = depths.get(step.id) ?? 0;
    const row = rows.get(depth) ?? 0;
    rows.set(depth, row + 1);
    positions.set(step.id, { x: 38 + depth * 300, y: 48 + row * 208 });
  });
  const columns = Math.max(1, ...[...depths.values()].map((depth) => depth + 1));
  const maxRows = Math.max(1, ...rows.values());
  const width = Math.max(640, 38 + columns * 300);
  const height = Math.max(520, 48 + maxRows * 208);

  return <div className="tj-workflow-graph-scroll" aria-label={`${workflow.name} workflow graph`}>
    <div className="tj-workflow-graph" style={{ width, height }}>
      <svg className="tj-workflow-edges" width={width} height={height} aria-hidden="true">
        {workflow.steps.flatMap((target) => target.depends_on.map((dependency) => {
          const from = positions.get(dependency); const to = positions.get(target.id);
          if (!from || !to) return null;
          const startX = from.x + 240; const startY = from.y + 78; const endX = to.x; const endY = to.y + 78;
          const bend = Math.max(24, (endX - startX) * 0.48);
          return <g key={`${dependency}-${target.id}`}><path d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`} /><circle cx={startX} cy={startY} r="4" /><circle cx={endX} cy={endY} r="4" /></g>;
        }))}
      </svg>
      {workflow.steps.map((step) => {
        const position = positions.get(step.id)!;
        const status = run?.step_state[step.id]?.status;
        const preview = typeof step.config.prompt === 'string' ? step.config.prompt : typeof step.config.instruction === 'string' ? step.config.instruction : '';
        return <button type="button" key={step.id} className={`tj-workflow-node kind-${step.kind} ${status ? `is-${status}` : 'is-unrun'} ${selectedStepId === step.id ? 'is-selected' : ''}`} style={{ left: position.x, top: position.y }} onClick={() => onSelectStep?.(step.id)} aria-pressed={selectedStepId === step.id} aria-label={`${step.name}, ${step.kind}, ${status ?? 'not run'}${editable ? ', edit step' : ''}`} title={editable ? 'Select to edit this step' : `${step.name} · ${step.kind}`}>
          <span className="tj-workflow-node-head"><span className="tj-workflow-node-icon" aria-hidden="true">{kindIcon[step.kind] ?? '✧'}</span><strong>{step.name}</strong><span className="tj-workflow-node-menu" aria-hidden="true">⋯</span></span>
          <span className="tj-workflow-node-meta">{step.kind.replaceAll('_', ' ').toUpperCase()} <span>{status ? status.replaceAll('_', ' ') : 'NOT RUN'}</span></span>
          <span className="tj-workflow-node-body">{preview.trim() ? preview : step.depends_on.length ? `Receives input from ${step.depends_on.length} step${step.depends_on.length === 1 ? '' : 's'}` : 'Starts this workflow'}</span>
          <span className="tj-workflow-node-foot"><span>{step.depends_on.length ? `${step.depends_on.length} INPUT${step.depends_on.length === 1 ? '' : 'S'}` : 'TRIGGER'}</span><span>OUTPUT</span></span>
          <span className="tj-workflow-node-port is-input" aria-hidden="true" /><span className="tj-workflow-node-port is-output" aria-hidden="true" />
        </button>;
      })}
      {workflow.steps.length === 0 && <p className="tj-workflow-empty-graph">No steps in this workflow.</p>}
    </div>
  </div>;
};
