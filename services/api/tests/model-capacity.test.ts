import { describe, it, expect } from 'vitest';
import { ModelCapacityLimiter } from '../src/models/capacity.js';

describe('Hardware-aware model queue', () => {
  it('serializes local inference and releases the next waiter', async () => {
    const limiter = new ModelCapacityLimiter();
    const releaseA = await limiter.acquire('ollama', 1);
    let started = false;
    const waiting = limiter.acquire('ollama', 1).then((release) => { started = true; return release; });
    await Promise.resolve();
    expect(started).toBe(false);
    releaseA();
    const releaseB = await waiting;
    expect(started).toBe(true);
    releaseB();
  });
  it('cancels queued work without consuming capacity', async () => {
    const limiter = new ModelCapacityLimiter();
    const release = await limiter.acquire('local', 1);
    const ctrl = new AbortController();
    const blocked = limiter.acquire('local', 1, ctrl.signal);
    ctrl.abort();
    await expect(blocked).rejects.toThrow(/cancelled/i);
    release();
    const next = await limiter.acquire('local', 1);
    next();
  });
  it('supports independent provider lanes', async () => {
    const limiter = new ModelCapacityLimiter();
    const a = await limiter.acquire('a', 1);
    const b = await limiter.acquire('b', 1);
    a(); b();
  });
});