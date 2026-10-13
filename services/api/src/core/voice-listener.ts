import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';
import type { EventBus } from './event-bus.js';

function resolveScript(name: string): string | null {
  const candidates = [
    path.join(REPO_ROOT, 'services', 'api', 'scripts', name),
    path.join(path.dirname(process.execPath), 'resources', 'services', 'api', 'scripts', name),
    path.join(path.dirname(process.execPath), 'services', 'api', 'scripts', name),
    path.join(process.cwd(), 'services', 'api', 'scripts', name),
    path.join('C:\\Projects\\tj-total-mastery-ai\\services\\api\\scripts', name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export type WindowsVoice = { name: string; gender: string; culture: string };

export async function listLocalVoices(): Promise<WindowsVoice[]> {
  const scriptPath = resolveScript('voice-voices.ps1');
  if (process.platform !== 'win32' || !scriptPath) return [];
  return new Promise<WindowsVoice[]>((resolve) => {
    let settled = false;
    const finish = (result: WindowsVoice[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish([]);
    }, 1500);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-File', scriptPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', () => finish([]));
    child.on('close', (code) => {
      if (code !== 0) { finish([]); return; }
      try {
        const parsed: unknown = JSON.parse(output);
        if (!Array.isArray(parsed)) { finish([]); return; }
        finish(parsed.filter((voice): voice is WindowsVoice => typeof voice === 'object' && voice !== null && typeof voice.name === 'string' && typeof voice.gender === 'string' && typeof voice.culture === 'string'));
      } catch { finish([]); }
    });
  });
}

export async function speakLocally(text: string, voiceId?: string, signal?: AbortSignal): Promise<void> {
  const speakScript = resolveScript('voice-speak.ps1');
  if (process.platform !== 'win32' || !speakScript) return;
  await new Promise<void>((resolve, reject) => {
    const voiceName = voiceId?.startsWith('windows:') ? voiceId.slice(8) : '';
    const args = ['-NoProfile', '-NonInteractive', '-Sta', '-File', speakScript,
      ...(voiceName === 'female' ? ['-Female'] : voiceName && voiceName !== 'default' ? ['-VoiceName', voiceName] : [])];
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted || code === 0) resolve();
      else reject(new Error('Windows voice playback failed.'));
    });
    child.stdin?.end(text.slice(0, 450));
  });
}

export class VoiceListener {
  private process: ChildProcess | null = null;
  private ready = false;
  private culture: string | null = null;
  private lastError: string | null = null;
  constructor(private bus: EventBus, private onTranscript: (text: string) => Promise<void>) {}

  status() {
    const script = resolveScript('voice-listener.ps1');
    return { available: process.platform === 'win32' && !!script, listening: this.process !== null && this.ready, starting: this.process !== null && !this.ready, culture: this.culture, error: this.lastError };
  }

  start() {
    if (this.process) return this.status();
    const script = resolveScript('voice-listener.ps1');
    if (process.platform !== 'win32' || !script) throw new Error('Windows speech listener is unavailable.');
    this.lastError = null; this.ready = false;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-File', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.process = child;
    let buffer = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        try {
          const message = JSON.parse(line);
          if (message.ready) { this.ready = true; this.culture = message.culture; this.bus.emit({ name: 'voice.listening', summary: `TJ voice listening (${this.culture})` }); }
          else if (message.error) { this.lastError = message.error; this.bus.emit({ name: 'voice.error', severity: 'error', summary: message.error }); }
          else if (typeof message.text === 'string' && message.confidence >= 0.35) {
            void this.onTranscript(message.text).catch((error) => this.bus.emit({ name: 'voice.error', severity: 'error', summary: String(error) }));
          }
        } catch { /* Ignore malformed recognizer output. */ }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { this.lastError = chunk.toString().slice(0, 500); });
    child.on('error', (error) => { this.lastError = error.message; });
    child.on('close', () => {
      if (this.process === child) { this.process = null; this.ready = false; this.bus.emit({ name: 'voice.stopped', summary: this.lastError ?? 'TJ voice listening stopped' }); }
    });
    return this.status();
  }

  stop() {
    this.process?.kill();
    this.process = null; this.ready = false;
    this.bus.emit({ name: 'voice.stopped', summary: 'TJ voice listening stopped' });
    return this.status();
  }
}
