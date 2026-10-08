import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../config.js';

export class LocalASR {
  private child: ChildProcess | null = null;
  private ready = false;
  private starting: Promise<void> | null = null;
  private waiting = new Map<string, { resolve: (value: { text: string; language_code: string | null }) => void; reject: (error: Error) => void }>();
  private readonly root: string;
  private readonly python: string;
  private model: 'tiny' | 'base' | null = null;

  constructor(dataDir: string, private recognitionMode: () => 'fast' | 'accurate' = () => 'fast') {
    this.root = path.join(dataDir, 'voice-models');
    this.python = path.join(dataDir, 'voice-venv', 'Scripts', 'python.exe');
    fs.mkdirSync(this.root, { recursive: true });
  }

  available() { return process.platform === 'win32' && fs.existsSync(this.python); }
  status() { return { available: this.available(), ready: this.ready, starting: !!this.starting, model: this.model }; }

  async start(): Promise<void> {
    const selectedModel = this.recognitionMode() === 'accurate' ? 'base' : 'tiny';
    if (this.ready && this.model === selectedModel) return;
    if (this.starting) return this.starting;
    if (!this.available()) throw new Error('Local multilingual speech model is not installed.');
    if (this.child) this.stop();
    this.starting = new Promise<void>((resolve, reject) => {
      const child = spawn(this.python, [path.join(REPO_ROOT, 'services', 'api', 'scripts', 'local-asr.py'), selectedModel, this.root], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      });
      this.child = child; this.model = selectedModel;
      let buffer = ''; let settled = false; let stderr = '';
      const timeout = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error('Local speech model startup timed out.')); } }, 180_000);
      child.stdout?.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        for (;;) {
          const newline = buffer.indexOf('\n');
          if (newline < 0) break;
          const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
          try {
            const item = JSON.parse(line);
            if (item.ready) { this.ready = true; if (!settled) { settled = true; clearTimeout(timeout); resolve(); } }
            else if (item.error && !item.id) { if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(item.error)); } }
            else if (item.id && this.waiting.has(item.id)) {
              const pending = this.waiting.get(item.id)!; this.waiting.delete(item.id);
              if (item.error) pending.reject(new Error(item.error));
              else pending.resolve({ text: item.text ?? '', language_code: item.language_code ?? null });
            }
          } catch { /* Skip malformed worker output. */ }
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 600) stderr += chunk.toString(); });
      child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timeout); reject(error); } });
      child.on('close', () => {
        if (this.child === child) { this.child = null; this.ready = false; this.model = null; }
        if (!settled) { settled = true; clearTimeout(timeout); reject(new Error(stderr.trim() || 'Local speech worker stopped.')); }
        for (const pending of this.waiting.values()) pending.reject(new Error('Local speech worker stopped.'));
        this.waiting.clear();
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async transcribe(wav: Buffer): Promise<{ text: string; language_code: string | null }> {
    await this.start();
    const id = randomUUID();
    const clip = path.join(this.root, `${id}.wav`);
    fs.writeFileSync(clip, wav);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error('Local transcription timed out.')); }, 45_000);
        this.waiting.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        this.child?.stdin?.write(JSON.stringify({ id, path: clip }) + '\n');
      });
    } finally { try { fs.unlinkSync(clip); } catch { /* clip already removed */ } }
  }

  stop() { this.child?.kill(); this.child = null; this.ready = false; this.model = null; }
}
