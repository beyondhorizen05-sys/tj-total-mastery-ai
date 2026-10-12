type SessionCallbacks = {
  onSpeechStart: () => void;
  onTurn: (wav: Blob) => void;
  onLevel?: (speaking: boolean) => void;
};

const TARGET_RATE = 16_000;
const FRAME_SIZE = 2_048;
const SPEECH_START_FRAMES = 3;
const END_SILENCE_FRAMES = 5;
const frameRms = (samples: Float32Array) => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
};

function pcmWav(samples: Float32Array, sourceRate: number) {
  const ratio = sourceRate / TARGET_RATE;
  const outputLength = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sample = 0;
    for (let j = start; j < end; j++) sample += samples[j];
    sample /= Math.max(1, end - start);
    pcm[i] = Math.max(-1, Math.min(1, sample)) < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const bytes = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(bytes);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true); view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, pcm.byteLength, true);
  new Int16Array(bytes, 44).set(pcm);
  return new Blob([bytes], { type: 'audio/wav' });
}

/** Browser-owned duplex microphone capture; browser AEC can use the tab's playback as its echo reference. */
export class BrowserVoiceSession {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private frames: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private active = false;
  private startCount = 0;
  private silenceCount = 0;
  private noiseFloor = 0.004;
  private totalSamples = 0;
  private callbacks: SessionCallbacks;

  constructor(callbacks: SessionCallbacks) { this.callbacks = callbacks; }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not provide microphone access.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.context = new AudioContext();
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(FRAME_SIZE, 1, 1);
    this.processor.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      this.processFrame(event.inputBuffer.getChannelData(0));
    };
    const silent = this.context.createGain(); silent.gain.value = 0;
    this.source.connect(this.processor); this.processor.connect(silent); silent.connect(this.context.destination);
  }

  private processFrame(input: Float32Array) {
    const frame = new Float32Array(input);
    const volume = frameRms(frame);
    const speech = volume > Math.max(0.012, this.noiseFloor * 3.2);
    if (!this.active) {
      this.preRoll.push(frame); if (this.preRoll.length > 4) this.preRoll.shift();
      if (!speech) this.noiseFloor = this.noiseFloor * 0.98 + Math.min(volume, 0.04) * 0.02;
      this.startCount = speech ? this.startCount + 1 : 0;
      if (this.startCount >= SPEECH_START_FRAMES) {
        this.active = true; this.frames = [...this.preRoll]; this.totalSamples = this.frames.reduce((n, item) => n + item.length, 0);
        this.silenceCount = 0; this.callbacks.onSpeechStart(); this.callbacks.onLevel?.(true);
      }
      return;
    }
    this.frames.push(frame); this.totalSamples += frame.length;
    if (speech) this.silenceCount = 0; else this.silenceCount++;
    if (this.silenceCount >= END_SILENCE_FRAMES || this.totalSamples >= this.context!.sampleRate * 14) this.finishTurn();
  }

  private finishTurn() {
    if (!this.active) return;
    this.active = false; this.startCount = 0; this.silenceCount = 0;
    const frames = this.frames; this.frames = []; this.preRoll = [];
    const samples = new Float32Array(frames.reduce((n, item) => n + item.length, 0));
    let offset = 0; for (const frame of frames) { samples.set(frame, offset); offset += frame.length; }
    this.callbacks.onLevel?.(false);
    if (samples.length >= this.context!.sampleRate * 0.3) this.callbacks.onTurn(pcmWav(samples, this.context!.sampleRate));
  }

  async stop() {
    this.finishTurn();
    this.processor?.disconnect(); this.source?.disconnect();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    await this.context?.close();
    this.processor = null; this.source = null; this.stream = null; this.context = null;
  }
}
