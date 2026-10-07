import { spawn } from 'node:child_process';
import type { Tool } from '../types.js';
import { ok, fail } from '../types.js';

/** Commands that are never run, even with approval (Spec §20 destructive/privileged). */
const BLOCKED = [
  /\bformat\s+[a-z]:/i, /\bdiskpart\b/i, /\bbcdedit\b/i, /\bshutdown\b/i, /\brm\s+-rf\s+\/(\s|$)/, /\bmkfs\b/i,
  /Remove-Item\s+.*-Recurse.*\s[a-z]:\\\s*$/i, /\breg\s+delete\b/i, /\bnet\s+user\b/i, /Set-ExecutionPolicy/i,
  /Invoke-Expression|\biex\b\s*\(/i, /DownloadString/i,
];

/** Commands considered read-only/inspection and safe at low risk. */
const SAFE_PREFIXES = [/^(node|npm|pnpm|npx|python|py|pip|git|tsc|vitest|eslint)\b/i, /^(dir|ls|echo|type|cat|pwd|cd|get-childitem|get-content|where|which|node -v)\b/i];

export function isBlocked(cmd: string): string | null {
  for (const re of BLOCKED) if (re.test(cmd)) return `Command matches blocked pattern ${re}`;
  return null;
}

export function shellTools(): Tool[] {
  return [
    {
      id: 'shell_exec', name: 'Run command', description: 'Run a shell command in the project directory (PowerShell on Windows, sh elsewhere). Returns stdout, stderr and exit code. Timeout 120s.', domain: 'shell',
      input_schema: { type: 'object', properties: { command: { type: 'string' }, cwd: { type: 'string' }, timeout_s: { type: 'number' } }, required: ['command'] },
      permission: 'shell.execute', risk: 'medium', reversible: false,
      resource: (_a, ctx) => ctx.project_root,
      describe: (a) => ({ action: 'Run shell command', target: String(a.command).slice(0, 200), why: 'Agent wants to execute a command', risks: ['Commands can modify files or system state', 'Not automatically reversible'] }),
      async execute(a, ctx) {
        const command = String(a.command ?? '').trim();
        if (!command) return fail('command is required');
        const blocked = isBlocked(command);
        if (blocked) return fail(`Refused: ${blocked}`);
        const cwd = ctx.project_root ?? process.cwd();
        const timeout = Math.min(Number(a.timeout_s ?? 120), 600) * 1000;
        const isWin = process.platform === 'win32';
        const child = isWin
          ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, windowsHide: true })
          : spawn('sh', ['-c', command], { cwd });
        let stdout = '', stderr = '';
        const cap = 100_000;
        child.stdout.on('data', (d) => { if (stdout.length < cap) stdout += d.toString(); });
        child.stderr.on('data', (d) => { if (stderr.length < cap) stderr += d.toString(); });
        const code: number | null = await new Promise((resolve) => {
          const timer = setTimeout(() => { child.kill(); resolve(-1); }, timeout);
          const onAbort = () => { child.kill(); resolve(-2); };
          ctx.signal?.addEventListener('abort', onAbort);
          child.on('close', (c) => { clearTimeout(timer); ctx.signal?.removeEventListener('abort', onAbort); resolve(c); });
          child.on('error', () => { clearTimeout(timer); resolve(-3); });
        });
        const timedOut = code === -1, aborted = code === -2;
        const out = `exit_code: ${code}${timedOut ? ' (TIMEOUT)' : aborted ? ' (CANCELLED)' : ''}\n--- stdout ---\n${stdout.trim()}\n--- stderr ---\n${stderr.trim()}`;
        return { ok: code === 0, output: out, data: { exit_code: code, stdout, stderr, timed_out: timedOut }, error: code === 0 ? undefined : `exit code ${code}` };
      },
    },
  ];
}

export { SAFE_PREFIXES };
