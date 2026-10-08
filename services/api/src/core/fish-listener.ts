import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { EventBus } from './event-bus.js';
import { HandsFreeWakeGate } from './voice-intent.js';

const execFileAsync = promisify(execFile);
const SAMPLE_RATE = 16_000;
const FRAME_BYTES = 640; // 20 ms, signed 16-bit mono

function makeWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function rms(frame: Buffer): number {
  let sum = 0;
  for (let offset = 0; offset < frame.length; offset += 2) {
    const sample = frame.readInt16LE(offset);
    sum += sample * sample;
  }
  return Math.sqrt(sum / (frame.length / 2));
}

export class FishHandsFreeListener {
  private child: ChildProcess | null = null;
  private desired = false;
  private suspended = false;
  private processing = false;
  private lastError: string | null = null;
  private device: string | null = null;
  private lastTranscriptionMs: number | null = null;
  private wakeGate = new HandsFreeWakeGate();

  constructor(private transcribeAudio: (wav: Buffer) => Promise<{ text: string; language_code: string | null }>, private engine: 'fish-audio' | 'local-whisper', private bus: EventBus, private onTranscript: (text: string, language: string | null) => Promise<void>) {}
  status() { return { available: process.platform === 'win32', listening: this.desired && !!this.child && !this.suspended, speaking: this.desired && this.suspended, starting: this.desired && !this.child && !this.suspended, transcribing: this.processing, culture: 'auto', engine: this.engine, microphone: this.device, last_transcription_ms: this.lastTranscriptionMs, error: this.lastError }; }

  private async detectMicrophone() {
    let listing = '';
    try { const result = await execFileAsync('ffmpeg', ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'], { windowsHide: true, timeout: 10_000 }); listing = result.stderr; }
    catch (error) { listing = String((error as { stderr?: string }).stderr ?? ''); }
    const devices = [...listing.matchAll(/"([^"\r\n]+)" \(audio\)/g)].map((match) => match[1]);
    if (devices.length) return devices[0];
    throw new Error('FFmpeg found no Windows microphone.');
  }

  async start() {
    if (this.desired) return this.status();
    if (process.platform !== 'win32') throw new Error('Always-on microphone capture requires Windows.');
    this.device = await this.detectMicrophone();
    this.desired = true; this.lastError = null;
    this.capture();
    this.bus.emit({ name: 'voice.listening', summary: `TJ multilingual hands-free listening started (${this.engine})` });
    return this.status();
  }

  stop() {
    this.desired = false; this.suspended = false;
    this.wakeGate.reset();
    this.child?.kill(); this.child = null;
    this.bus.emit({ name: 'voice.stopped', summary: 'TJ multilingual listening stopped' });
    return this.status();
  }

  suspend() {
    if (this.suspended) return;
    this.suspended = true; this.child?.kill(); this.child = null;
    if (this.desired) this.bus.emit({ name: 'voice.speaking', summary: 'TJ is speaking; microphone paused to prevent echo' });
  }
  resume() {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.desired && !this.child && !this.processing) this.capture();
    if (this.desired) this.bus.emit({ name: 'voice.listening', summary: 'TJ is listening again' });
  }

  private capture() {
    if (!this.desired || this.suspended || !this.device || this.child) return;
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-i', `audio=${this.device}`, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    let carry = Buffer.alloc(0);
    const preRoll: Buffer[] = [];
    let frames: Buffer[] = [];
    let noise = 90;
    let startFrames = 0;
    let silenceFrames = 0;
    let voicedFrames = 0;
    let active = false;
    const finish = () => {
      if (this.child !== child || !active) return;
      active = false;
      const clipFrames = frames;
      frames = [];
      preRoll.length = 0;
      startFrames = 0;
      silenceFrames = 0;
      const enoughSpeech = voicedFrames >= 9 && clipFrames.length >= 25;
      voicedFrames = 0;
      // The local worker handles one clip at a time. Do not build an unbounded
      // queue from background audio while it is transcribing the current turn.
      if (!enoughSpeech || this.processing) return;
      this.processing = true;
      const wav = makeWav(Buffer.concat(clipFrames));
      const transcribeStarted = Date.now();
      void this.transcribeAudio(wav).then(async ({ text, language_code }) => {
        this.lastTranscriptionMs = Date.now() - transcribeStarted;
        if (!text || !this.desired) return;
        this.lastError = null;
        if (!this.wakeGate.accepts(text)) return;
        this.bus.emit({ name: 'voice.transcript', summary: text, data: { language_code, engine: this.engine, transcription_ms: this.lastTranscriptionMs } });
        // Keep one accepted turn in flight. Otherwise another clip can issue a
        // second command while the first is still using the computer or model.
        await this.onTranscript(text, language_code);
      }).catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.bus.emit({ name: 'voice.error', severity: 'error', summary: this.lastError });
      }).finally(() => { this.processing = false; this.capture(); });
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      carry = Buffer.concat([carry, chunk]);
      while (carry.length >= FRAME_BYTES) {
        const frame = Buffer.from(carry.subarray(0, FRAME_BYTES)); carry = carry.subarray(FRAME_BYTES);
        const volume = rms(frame);
        const threshold = Math.max(450, noise * 3.2);
        const speech = volume > threshold;
        if (!active) {
          preRoll.push(frame); if (preRoll.length > 20) preRoll.shift();
          if (!speech) noise = noise * 0.99 + Math.min(volume, 1000) * 0.01;
          startFrames = speech ? startFrames + 1 : 0;
          if (startFrames >= 4) { active = true; frames = [...preRoll]; voicedFrames = startFrames; silenceFrames = 0; }
        } else {
          frames.push(frame);
          if (speech) { voicedFrames++; silenceFrames = 0; } else silenceFrames++;
          if (silenceFrames >= 24 || frames.length >= 750) finish();
        }
      }
    });
    let captureError = '';
    child.stderr?.on('data', (chunk: Buffer) => { if (captureError.length < 500) captureError += chunk.toString(); });
    child.on('error', (error) => { captureError = error.message; });
    child.on('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (this.desired && !this.suspended && !this.processing) {
        this.lastError = captureError.trim() || `Microphone capture ended (${code}).`;
        this.bus.emit({ name: 'voice.error', severity: 'error', summary: this.lastError });
        this.desired = false;
      }
    });
  }
}
