import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Secret-masking patterns. Anything that looks like a credential is redacted before
 * it reaches stdout or the log file (Spec §43, §75).
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,                     // OpenAI-style
  /sk-ant-[A-Za-z0-9_-]{8,}/g,                 // Anthropic
  /AIza[0-9A-Za-z_-]{20,}/g,                   // Google
  /gsk_[A-Za-z0-9]{10,}/g,                     // Groq
  /xai-[A-Za-z0-9]{10,}/g,                     // xAI
  /ghp_[A-Za-z0-9]{20,}/g,                     // GitHub
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[abp]-[A-Za-z0-9-]{10,}/g,               // Slack
  /tvly-[A-Za-z0-9_-]{8,}/g,                   // Tavily
  /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /("?(api[_-]?key|token|secret|password|authorization)"?\s*[:=]\s*")([^"]{4,})(")/gi,
];

const knownSecrets = new Set<string>();
/** Register a live secret so it is masked wherever it appears. */
export function registerSecret(value: string | null | undefined) {
  if (value && value.length >= 6) knownSecrets.add(value);
}

export function maskSecrets(input: string): string {
  let out = input;
  for (const s of knownSecrets) {
    if (out.includes(s)) out = out.split(s).join('[REDACTED]');
  }
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, ...groups) => {
      if (groups.length >= 4 && typeof groups[0] === 'string' && typeof groups[3] === 'string') {
        return `${groups[0]}[REDACTED]${groups[3]}`;
      }
      return m.slice(0, Math.min(6, m.length)) + '…[REDACTED]';
    });
  }
  return out;
}

export class Logger {
  private minLevel: number;
  private stream: fs.WriteStream | null = null;
  constructor(private scope: string, logsDir?: string, level: LogLevel = (process.env.TJ_LOG_LEVEL as LogLevel) || 'info') {
    this.minLevel = LEVELS[level] ?? 20;
    if (logsDir) {
      fs.mkdirSync(logsDir, { recursive: true });
      this.stream = fs.createWriteStream(path.join(logsDir, 'tj.log'), { flags: 'a' });
    }
  }
  child(scope: string) {
    const l = new Logger(`${this.scope}:${scope}`);
    l.minLevel = this.minLevel;
    l.stream = this.stream;
    return l;
  }
  private write(level: LogLevel, msg: string, data?: Record<string, unknown>) {
    if (LEVELS[level] < this.minLevel) return;
    const rec = { ts: new Date().toISOString(), level, scope: this.scope, msg, ...(data ?? {}) };
    const line = maskSecrets(JSON.stringify(rec, (_k, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v)));
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
    this.stream?.write(line + '\n');
  }
  debug(msg: string, data?: Record<string, unknown>) { this.write('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>) { this.write('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { this.write('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>) { this.write('error', msg, data); }
  close() { this.stream?.end(); }
}
