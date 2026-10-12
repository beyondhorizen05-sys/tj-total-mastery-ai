import { describe, expect, it } from 'vitest';
import { BrowserVoiceSession } from '../../../apps/web/src/components/BrowserVoiceSession.js';
import { VoiceTurnGate } from '../src/core/voice-turn-gate.js';

describe('browser voice turn detection', () => {
  it('detects speech quickly and submits after a short natural pause', () => {
    const events: string[] = [];
    const turns: Blob[] = [];
    const session = new BrowserVoiceSession({
      onSpeechStart: () => events.push('speech-start'),
      onTurn: (audio) => { turns.push(audio); events.push('turn'); },
    });
    const probe = session as unknown as { context: { sampleRate: number }; processFrame(frame: Float32Array): void };
    probe.context = { sampleRate: 48_000 };

    const voice = new Float32Array(2_048).fill(0.12);
    const silence = new Float32Array(2_048);
    probe.processFrame(silence);
    probe.processFrame(voice);
    expect(events).toEqual([]);
    probe.processFrame(voice);
    probe.processFrame(voice);
    expect(events).toEqual(['speech-start']);
    for (let i = 0; i < 4; i++) probe.processFrame(silence);
    expect(turns).toHaveLength(0);
    probe.processFrame(silence);

    expect(events).toEqual(['speech-start', 'turn']);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toBeInstanceOf(Blob);
    expect(turns[0]?.type).toBe('audio/wav');
    expect(turns[0]!.size).toBeGreaterThan(44);
  });

  it('does not treat low-level room noise as speech', () => {
    const events: string[] = [];
    const session = new BrowserVoiceSession({ onSpeechStart: () => events.push('start'), onTurn: () => events.push('turn') });
    const probe = session as unknown as { context: { sampleRate: number }; processFrame(frame: Float32Array): void };
    probe.context = { sampleRate: 48_000 };
    for (let i = 0; i < 40; i++) probe.processFrame(new Float32Array(2_048).fill(0.003));
    expect(events).toEqual([]);
  });
});

describe('voice barge-in cancellation', () => {
  it('discards an earlier turn after a newer turn or interruption starts', () => {
    const gate = new VoiceTurnGate();
    const first = gate.begin();
    expect(gate.isCurrent(first)).toBe(true);
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(second)).toBe(false);
  });
});
