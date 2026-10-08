import { describe, expect, it } from 'vitest';
import { HandsFreeWakeGate, WAKE, isComputerIntent, isScreenObservationCommand, isVisualScreenCommand, takeSpeakableChunk } from '../src/core/voice-intent.js';

describe('voice intent routing', () => {
  it('releases a first spoken fragment before punctuation without dropping the remainder', () => {
    const answer = 'I can help you plan the next step and work through the details together while keeping each action clear and easy to review';
    const chunk = takeSpeakableChunk(answer);
    expect(chunk).not.toBeNull();
    expect(chunk!.trim().length).toBeGreaterThanOrEqual(55);
    expect(chunk! + answer.slice(chunk!.length)).toBe(answer);
    expect(takeSpeakableChunk('Short incomplete reply')).toBeNull();
    expect(takeSpeakableChunk('This is a complete sentence. More is coming')).toBe('This is a complete sentence.');
  });
  it('requires TJ wake-name before a short hands-free follow-up window', () => {
    const gate = new HandsFreeWakeGate(60_000);
    expect(gate.accepts('open browser', 1_000)).toBe(false);
    expect(gate.accepts('TJ, screen par kya hai', 2_000)).toBe(true);
    expect(gate.accepts('aur yeh bhi parho', 61_999)).toBe(true);
    expect(gate.accepts('open browser', 122_000)).toBe(false);
    expect(gate.accepts('ٹی جے، اسکرین دیکھو', 123_000)).toBe(true);
    gate.reset();
    expect(gate.accepts('open browser', 123_001)).toBe(false);
    expect('ٹی جے، اسکرین دیکھو'.replace(WAKE, '').trim()).toBe('اسکرین دیکھو');
  });
  it('sends everyday conversation to the short reply path', () => {
    for (const phrase of ['How are you, TJ?', 'Mera din acha nahi ja raha, baat karo', 'Aaj tum kaisi ho?', 'تم کیسی ہو؟']) {
      expect(isComputerIntent(phrase)).toBe(false);
    }
  });

  it('keeps spoken computer tasks on the permission-gated tool path', () => {
    for (const phrase of ['Please read the screen', 'Write this in Notepad', 'Meri file kholo', 'اسکرین دیکھو']) {
      expect(isComputerIntent(phrase)).toBe(true);
    }
  });

  it('recognizes direct local screen reading without a model', () => {
    for (const phrase of ['read the screen', 'Please read my screen', 'what do you see', 'screen par kya hai', 'screen par kya likha hai', 'اسکرین پر کیا لکھا ہے']) {
      expect(isScreenObservationCommand(phrase)).toBe(true);
    }
    for (const phrase of ['read a file', 'read the screenshot using vision', 'type screen par kya hai']) {
      expect(isScreenObservationCommand(phrase)).toBe(false);
    }
  });

  it('requires an explicit visual phrase for model-based screenshot reading', () => {
    for (const phrase of ['visually read the screen', 'read my screen using vision', 'use vision to describe my screen', 'screen ki tasveer se parho', 'اسکرین کی تصویر پڑھو']) {
      expect(isVisualScreenCommand(phrase)).toBe(true);
      expect(isScreenObservationCommand(phrase)).toBe(false);
    }
    expect(isVisualScreenCommand('read the screen')).toBe(false);
  });
});
