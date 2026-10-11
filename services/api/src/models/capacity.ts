import { ProviderError } from './types.js';

/** Per-provider concurrency queues; local inference respects CPU capacity. */
export class ModelCapacityLimiter {
  private readonly lanes = new Map<string, { active: number; waiting: Array<{ start: () => void; cancel: () => void }> }>();

  async acquire(provider: string, maxParallel: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new ProviderError('Request cancelled before inference', 'bad_request', undefined, false);
    const limit = Math.max(1, Math.min(16, Math.floor(maxParallel)));
    let lane = this.lanes.get(provider);
    if (!lane) { lane = { active: 0, waiting: [] }; this.lanes.set(provider, lane); }
    const slot = lane;
    let reserved = false;
    if (slot.active >= limit) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          slot.waiting = slot.waiting.filter((w) => w !== waiter);
          reject(new ProviderError('Request cancelled while waiting for model capacity', 'bad_request', undefined, false));
        };
        const waiter = {
          start: () => { signal?.removeEventListener('abort', onAbort); resolve(); },
          cancel: onAbort,
        };
        slot.waiting.push(waiter);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
      reserved = true;
    }
    if (!reserved) slot.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = slot.waiting.shift();
      if (next) next.start(); // Hand the existing slot directly to the waiter.
      else slot.active--;
      if (slot.active === 0 && !slot.waiting.length) this.lanes.delete(provider);
    };
  }
}
