import type { SettingsRepo } from '../db/repo.js';
import type { PermissionEngine } from '../security/permissions.js';
import type { ApprovalService } from '../security/approvals.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { WorkspaceService } from './workspace.js';
import type { AgentService } from '../agents/service.js';
import type { HealthMonitor } from './health.js';

const COMMAND = 'node -e "console.log(\'TJ_FULL_AUTONOMY_RUNTIME_OK\')"';
const MARKER = 'TJ_FULL_AUTONOMY_RUNTIME_OK';

/** Explicit opt-in to a fixed, harmless diagnostic; ordinary prompts use the normal planner. */
export function isFullAutonomyProbeRequest(text: string): boolean {
  return /\bRUNTIME\s+VERIFICATION\s+TEST\s*1\b[^\n]{0,100}\bFULL\s+AUTONOMY\b/i.test(text);
}

export interface FullAutonomyProbeResult {
  status: 'passed' | 'failed' | 'not_ready';
  detail: string;
  executed: boolean;
  autonomy_level: number;
  full_autonomy_enabled: boolean;
  agent_id?: string;
  agent_role?: string;
  project_root?: string;
  command?: string;
  tool?: string;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  user_approval_requested?: boolean;
  auto_approved?: boolean;
  approval_id?: string;
  approval_status?: string;
  approval_decided_by?: string | null;
}

export interface FullAutonomyProbeDeps {
  settings: SettingsRepo;
  permissions: PermissionEngine;
  approvals: ApprovalService;
  tools: ToolRegistry;
  workspace: WorkspaceService;
  agents: AgentService;
  health: HealthMonitor;
}

/**
 * Runs an actual shell command through the same permission/approval ToolRegistry as agents.
 * No model, planner, external network, arbitrary user command, or filesystem writes are needed.
 * Never silently approves a pending request merely to pass the diagnostic.
 */
export async function runFullAutonomyProbe(deps: FullAutonomyProbeDeps): Promise<FullAutonomyProbeResult> {
  const autonomy = deps.settings.get<number>('autonomy_level', 2);
  const enabled = deps.permissions.isHighRiskAutoApprovalEnabled();
  const base = { autonomy_level: autonomy, full_autonomy_enabled: enabled };
  if (deps.health.isStopped()) {
    return { ...base, status: 'not_ready', executed: false, detail: 'STOP ALL is engaged; no command was executed.' };
  }
  if (!enabled) {
    return {
      ...base, status: 'not_ready', executed: false,
      detail: 'Select Privileged (level 5) and enable Full Autonomy in Settings. No command was executed.',
    };
  }

  const project = deps.workspace.createProject('Full Autonomy Runtime Check', 'Isolated fixed-command approval and shell execution test');
  const agent = deps.agents.create({
    workspace_id: deps.workspace.workspaceId, project_id: project.id, name: 'Runtime Verification Developer',
    role: 'Developer', permissions: ['shell.execute'], tools: ['shell_exec'],
  });
  const context = {
    workspace_id: deps.workspace.workspaceId, project_id: project.id, project_root: project.root_path,
    agent_id: agent.id, agent_permissions: ['shell.execute'], task_id: null, workflow_run_id: null,
  };
  const diagnostic = {
    ...base, agent_id: agent.id, agent_role: agent.role, project_root: project.root_path,
    command: COMMAND, tool: 'shell_exec',
  };

  deps.agents.setStatus(agent.id, 'working');
  try {
    const execution = deps.tools.execute('shell_exec', { command: COMMAND, timeout_s: 15 }, context);
    // ToolRegistry creates pending approvals synchronously before awaiting a decision.
    // Detect and deny only this diagnostic's unexpected request to avoid hanging.
    const pending = deps.approvals.list('pending', 100).find((item) =>
      item.agent_id === agent.id && item.tools.includes('shell_exec'));
    if (pending) {
      deps.approvals.decide(pending.id, 'deny', 'runtime_probe_guard');
      await execution.catch(() => null);
      deps.agents.setStatus(agent.id, 'failed');
      return {
        ...diagnostic, status: 'failed', executed: false, user_approval_requested: true,
        auto_approved: false, approval_id: pending.id, approval_status: 'denied',
        detail: 'Unexpected manual approval request for the authorized project-scoped medium-risk shell command; the diagnostic denied it safely.',
      };
    }

    const result = await execution;
    const data = result.data as Record<string, unknown> | undefined;
    const exit_code = typeof data?.exit_code === 'number' ? data.exit_code : null;
    const stdout = typeof data?.stdout === 'string' ? data.stdout.trim() : '';
    const stderr = typeof data?.stderr === 'string' ? data.stderr.trim() : '';
    const approval = deps.approvals.list(undefined, 100).find((item) =>
      item.agent_id === agent.id && item.tools.includes('shell_exec'));
    const autoApproved = approval?.status === 'approved' && approval.decided_by === 'full_autonomy_policy';
    const passed = result.ok && exit_code === 0 && stdout.includes(MARKER) && Boolean(autoApproved);
    deps.agents.setStatus(agent.id, passed ? 'completed' : 'failed');
    deps.agents.addMetrics(agent.id, {
      tasks_completed: passed ? 1 : 0, tasks_failed: passed ? 0 : 1, tool_calls: 1,
    });
    return {
      ...diagnostic, status: passed ? 'passed' : 'failed', executed: true, exit_code, stdout, stderr,
      user_approval_requested: false, auto_approved: Boolean(autoApproved),
      approval_id: approval?.id, approval_status: approval?.status, approval_decided_by: approval?.decided_by,
      detail: passed
        ? 'Actual project-scoped shell execution and automatic approval were verified against the persisted approval record.'
        : 'Shell output, exit code, or persisted automatic approval did not match the expected evidence. See diagnostic fields.',
    };
  } catch (error) {
    deps.agents.setStatus(agent.id, 'failed');
    return {
      ...diagnostic, status: 'failed', executed: false, auto_approved: false,
      detail: 'Runtime check could not execute: ' + (error instanceof Error ? error.message : String(error)),
    };
  }
}

export function formatFullAutonomyProbe(result: FullAutonomyProbeResult): string {
  const fields = [
    'FULL AUTONOMY RUNTIME VERIFICATION: ' + result.status.toUpperCase(),
    result.detail,
    'Autonomy level: ' + result.autonomy_level,
    'Full Autonomy enabled: ' + result.full_autonomy_enabled,
    'Developer agent: ' + (result.agent_id ?? '(not created)'),
    'Registered tool: ' + (result.tool ?? '(not executed)'),
    'Project root: ' + (result.project_root ?? '(none)'),
    'Exact command: ' + (result.command ?? '(none)'),
    'Command executed: ' + result.executed,
    'Exit code: ' + (result.exit_code ?? '(none)'),
    'Stdout: ' + (result.stdout ?? '(none)'),
    'Stderr: ' + (result.stderr ?? '(none)'),
    'Manual approval requested: ' + (result.user_approval_requested ?? '(not evaluated)'),
    'Automatic approval persisted: ' + (result.auto_approved ?? false),
    'Approval id: ' + (result.approval_id ?? '(none)'),
    'Approval status: ' + (result.approval_status ?? '(none)'),
    'Approval decided by: ' + (result.approval_decided_by ?? '(none)'),
    'Scope: fixed harmless command only. AI model planning and arbitrary medium-risk actions were not tested.',
  ];
  return fields.join('\n');
}
