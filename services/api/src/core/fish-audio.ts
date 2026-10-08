import { spawn } from 'node:child_process';
import type { Vault } from '../security/vault.js';
import type { SettingsRepo } from '../db/repo.js';

export type FishVoice = { id: string; name: string; languages: string[]; state: string };
const BASE = 'https://api.fish.audio';

export class FishAudioService {
  constructor(private vault: Vault, private settings: SettingsRepo) {}

  configured() { return !!this.settings.get<string | null>('fish_api_key_ref', null); }
  private key() {
    const ref = this.settings.get<string | null>('fish_api_key_ref', null);
    const value = ref ? this.vault.get(ref, 'fish_audio', 'speech service') : null;
    if (!value) throw new Error('Fish Audio is not configured.');
    return value;
  }

  async configure(apiKey: string) {
    const key = apiKey.trim();
    if (!/^sk-fish-[A-Za-z0-9_-]{15,}$/.test(key)) throw new Error('Invalid Fish Audio API key format.');
    const voices = await this.fetchVoices(key, 1);
    const old = this.settings.get<string | null>('fish_api_key_ref', null);
    const ref = this.vault.put({ label: 'Fish Audio API key', scope: 'voice', value: key, ref: old ?? undefined });
    this.settings.set('fish_api_key_ref', ref);
    return voices;
  }

  async voices(): Promise<FishVoice[]> {
    const key = this.key();
    const found: FishVoice[] = [];
    for (let page = 1; page <= 5; page++) {
      const batch = await this.fetchVoices(key, page);
      found.push(...batch);
      if (batch.length < 100) break;
    }
    return found;
  }

  private async fetchVoices(key: string, page: number): Promise<FishVoice[]> {
    const url = `${BASE}/model?self=true&page_size=100&page_number=${page}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`Fish Audio voice list failed (HTTP ${response.status}).`);
    const body = await response.json() as { items?: Array<{ _id?: string; title?: string; languages?: string[]; state?: string }> };
    if (!Array.isArray(body.items)) throw new Error('Fish Audio returned an invalid voice list.');
    return body.items.filter((item) => typeof item._id === 'string').map((item) => ({ id: item._id!, name: item.title || 'Untitled voice', languages: item.languages ?? [], state: item.state ?? 'unknown' }));
  }

  async transcribe(wav: Buffer): Promise<{ text: string; language_code: string | null }> {
    if (wav.length < 1000 || wav.length > 8_000_000) throw new Error('Audio clip length is outside supported limits.');
    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.append('ignore_timestamps', 'true');
    const response = await fetch(`${BASE}/v1/asr`, { method: 'POST', headers: { Authorization: `Bearer ${this.key()}`, model: 'transcribe-1-pro' }, body: form, signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`Fish Audio transcription failed (HTTP ${response.status}).`);
    const result = await response.json() as { text?: string; language_code?: string };
    if (typeof result.text !== 'string') throw new Error('Fish Audio returned no transcript.');
    return { text: result.text.trim(), language_code: result.language_code || null };
  }

  async synthesize(text: string, voiceId: string): Promise<Buffer> {
    const response = await this.ttsResponse(text, voiceId);
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length < 100 || audio.length > 10_000_000) throw new Error('Fish Audio returned an invalid audio clip.');
    return audio;
  }

  private async ttsResponse(text: string, voiceId: string): Promise<Response> {
    if (!voiceId || text.trim().length === 0) throw new Error('Choose a Fish Audio voice and enter text.');
    const response = await fetch(`${BASE}/v1/tts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key()}`, 'Content-Type': 'application/json', model: 's2.1-pro-free' },
      body: JSON.stringify({ text: text.slice(0, 700), reference_id: voiceId, format: 'mp3', latency: 'balanced' }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`Fish Audio speech generation failed (HTTP ${response.status}).`);
    return response;
  }

  async playStreaming(text: string, voiceId: string): Promise<void> {
    const response = await this.ttsResponse(text, voiceId);
    const body = response.body;
    if (!body) throw new Error('Fish Audio returned no audio stream.');
    const child = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', '-i', 'pipe:0'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let error = '';
    child.stderr.on('data', (chunk) => { if (error.length < 500) error += chunk.toString(); });
    const finished = new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.stdin.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `Audio playback failed (${code}).`)));
    });
    // Attach a handler immediately so an early player failure does not surface
    // as an unhandled rejection while the HTTP stream is being read.
    void finished.catch(() => {});
    try {
      let bytes = 0;
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 10_000_000) throw new Error('Fish Audio clip exceeded the playback limit.');
          child.stdin.write(value);
        }
      } finally { reader.releaseLock(); }
      if (bytes < 100) throw new Error('Fish Audio returned an invalid audio clip.');
      child.stdin.end();
      await finished;
    } catch (reason) {
      child.kill();
      throw reason;
    }
  }

  async play(audio: Buffer): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', '-i', 'pipe:0'], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      let error = '';
      child.stderr.on('data', (chunk) => { if (error.length < 500) error += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `Audio playback failed (${code}).`)));
      child.stdin.end(audio);
    });
  }
}
