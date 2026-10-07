import type { Permission, RiskLevel } from '@tj/schemas';

export interface ToolContext {
  workspace_id: string;
  project_id: string | null;
  project_root: string | null;
  agent_id: string | null;
  agent_permissions: string[] | null;
  task_id: string | null;
  workflow_run_id: string | null;
  signal?: AbortSignal;
  /** emits progress text to task/activity stream */
  progress?: (msg: string) => void;
}

export interface ToolResult {
  ok: boolean;
  /** text handed back to the model */
  output: string;
  /** structured data for UI/artifacts */
  data?: Record<string, unknown>;
  error?: string;
  artifacts?: Array<{ kind: string; name: string; path?: string; mime?: string; summary?: string }>;
  duration_ms?: number;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  domain: string;
  input_schema: Record<string, unknown>;
  /** permission required; resource resolver extracts the resource string for policy matching */
  permission: Permission;
  risk: RiskLevel;
  reversible: boolean;
  resource?: (args: Record<string, any>, ctx: ToolContext) => string | null;
  /** human description for the action-review gate */
  describe?: (args: Record<string, any>) => { action: string; target: string; why: string; risks: string[] };
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}

export class ToolDenied extends Error {
  constructor(message: string, public readonly approval_id?: string) {
    super(message);
    this.name = 'ToolDenied';
  }
}

export const ok = (output: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: true, output, ...extra });
export const fail = (error: string, extra: Partial<ToolResult> = {}): ToolResult => ({ ok: false, output: `ERROR: ${error}`, error, ...extra });
