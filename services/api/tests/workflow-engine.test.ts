import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { step } from './helpers/steps.js';

describe('WorkflowEngine', () => {
  let db: Database, bus: EventBus, engine: WorkflowEngine;
  beforeEach(() => {
    db = new Database(':memory:'); db.migrate();
    bus = new EventBus(db);
    engine = new WorkflowEngine(db, bus, () => 'ws1');
  });

  it('runs a DAG in dependency order and passes outputs via templates', async () => {
    const order: string[] = [];
    engine.registerExecutor('tool', async (s, cfg) => { order.push(s.id); return { v: s.id, got: cfg.in }; });
    const wf = engine.save({ name: 'dag', steps: [step('a'), step('b', ['a'], { config: { in: '{{steps.a.output.v}}' } }), step('c', ['b'])] });
    const done = await engine.wait(engine.start(wf.id).id);
    expect(done.status).toBe('completed');
    expect(order).toEqual(['a', 'b', 'c']);
    expect((done.step_state.b.output as any).got).toBe('a');
  });

  it('runs independent steps in parallel', async () => {
    let active = 0, peak = 0;
    engine.registerExecutor('tool', async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 60)); active--; return 1; });
    const wf = engine.save({ name: 'par', steps: [step('a'), step('b'), step('c'), step('d', ['a', 'b', 'c'])] });
    const done = await engine.wait(engine.start(wf.id).id);
    expect(done.status).toBe('completed');
    expect(peak).toBeGreaterThanOrEqual(3);
  });

  it('keeps a paused run persisted while an active step finishes', async () => {
    let release!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      engine.registerExecutor('tool', async (s) => {
        if (s.id === 'a') {
          resolve();
          await new Promise<void>((done) => { release = done; });
        }
        return s.id;
      });
    });
    const wf = engine.save({ name: 'pause', steps: [step('a'), step('b', ['a'])] });
    const run = engine.start(wf.id);
    await firstStarted;
    engine.pause(run.id);
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(engine.getRun(run.id)?.status).toBe('paused');
    expect(engine.getRun(run.id)?.step_state.a.status).toBe('completed');
    expect(engine.getRun(run.id)?.step_state.b.status).toBe('pending');
    engine.resume(run.id);
    const done = await engine.wait(run.id);
    expect(done.status).toBe('completed');
    expect(done.step_state.b.status).toBe('completed');
  });

  it('retries with backoff and then succeeds', async () => {
    let calls = 0;
    engine.registerExecutor('tool', async () => { calls++; if (calls < 3) throw new Error('flaky'); return 'ok'; });
    const wf = engine.save({ name: 'retry', steps: [step('a', [], { retry: { max_attempts: 3, backoff_ms: 10, max_backoff_ms: 50 } })] });
    const done = await engine.wait(engine.start(wf.id).id);
    expect(done.status).toBe('completed');
    expect(calls).toBe(3);
    expect(done.step_state.a.attempts).toBe(3);
    expect(db.all("SELECT * FROM events WHERE name = 'workflow.retrying'").length).toBe(2);
  });

  it('fails the run and skips dependents when retries are exhausted', async () => {
    engine.registerExecutor('tool', async (s) => { if (s.id === 'a') throw new Error('boom'); return 1; });
    const wf = engine.save({ name: 'fail', steps: [step('a', [], { retry: { max_attempts: 2, backoff_ms: 5, max_backoff_ms: 10 } }), step('b', ['a'])] });
    const done = await engine.wait(engine.start(wf.id).id);
    expect(done.status).toBe('failed');
    expect(done.step_state.a.status).toBe('failed');
    expect(done.step_state.b.status).toBe('skipped');
    expect(done.error).toContain('boom');
  });

  it('continue_on_error yields a completed run with partial results', async () => {
    engine.registerExecutor('tool', async (s) => { if (s.id === 'mail') throw new Error('connector down'); return s.id; });
    const wf = engine.save({ name: 'partial', steps: [step('cal'), step('mail', [], { continue_on_error: true }), step('summary', ['cal', 'mail'], { continue_on_error: true })] });
    const done = await engine.wait(engine.start(wf.id).id);
    expect(done.status).toBe('completed');
    expect(done.checkpoint.partial).toBe(true);
    expect(done.step_state.mail.status).toBe('failed');
    expect(done.step_state.summary.status).toBe('completed');
  });

  it('times out a hung step', async () => {
    engine.registerExecutor('tool', () => new Promise(() => {}));
    const wf = engine.save({ name: 'timeout', steps: [step('a', [], { timeout_ms: 50 })] });
    const done = await engine.wait(engine.start(wf.id).id);
    expect(done.status).toBe('failed');
    expect(done.step_state.a.error).toContain('timed out');
  });
});
