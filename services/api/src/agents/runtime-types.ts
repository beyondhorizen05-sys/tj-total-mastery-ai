import type { Agent } from '@tj/schemas';
import type { TaskType } from '../models/router.js';

export interface AgentRunInput {
  agent: Agent;
  instruction: string;
  /** context from upstream tasks / memory */
  context?: string;
  workspace_id: string;
  project_id: string | null;
  project_root: string | null;
  task_id: string | null;
  workflow_run_id?: string | null;
  signal?: AbortSignal;
  max_steps?: number;
  task_type?: TaskType;
  onProgress?: (msg: string) => void;
}

export interface AgentRunResult {
  ok: boolean;
  output: string;
  steps: number;
  tool_calls: Array<{ tool: string; ok: boolean; summary: string; duration_ms?: number }>;
  artifacts: Array<{ kind: string; name: string; path?: string; mime?: string; summary?: string }>;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  model_id: string | null;
  error?: string;
  denied?: boolean;
  fallback_from?: string;
}
