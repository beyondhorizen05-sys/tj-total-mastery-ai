import { describe, it, expect, beforeEach } from 'vitest';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { evalCondition, interpolate } from '../src/workflows/template.js';
import { step } from './helpers/steps.js';

describe('WorkflowEngine controls', () => {
  let db: Database, bus: EventBus, engine: WorkflowEngine;
  beforeEach(() => {
    db = new Database(':memory:'); db.migrate();
    bus = new EventBus(db);
    engine = new WorkflowEngine(db, bus, () => 'ws1');
  });

  it('supports pause, resume and cancel', async () => {
    engine.registerExecutor('tool', async () => { await new Promise((r) => setTimeout(r, 80)); return 1; });
    const wf = engine.save({ name: 'ctl', steps: [step('a'), step('b', ['a']), step('c', ['b'])] });
    const run = engine.start(wf.id);
    await new Promise((r) => setTimeout(r, 20));
    engine.pause(run.id);
    expect(engine.getRun(run.id)!.status).toBe('paused');
    engine.resume(run.id);
    expect(engine.getRun(run.id)!.status).toBe('running');
    engine.cancel(run.id);
    const done = await engine.wait(run.id);
    expect(done.status).toBe('cancelled');
  });

  it('skips steps whose condition is false', async () => {
    engine.registerExecutor('tool', async (s) => s.id);
    const wf = engine.save({ name: 'cond', steps: [step('a'), step('b', ['a'], { config: { when: 'inputs.go == true' } })] });
    const done = await engine.wait(engine.start(wf.id, { go: false }).id);
    expect(done.step_state.b.status).toBe('skipped');
    expect(done.status).toBe('completed');
  });

  it('rejects cycles and unknown dependencies, and versions on update', () => {
    expect(() => engine.save({ name: 'cyc', steps: [step('a', ['b']), step('b', ['a'])] })).toThrow(/Cycle/);
    expect(() => engine.save({ name: 'dangling', steps: [step('a', ['zzz'])] })).toThrow(/unknown step/);
    const v1 = engine.save({ name: 'v', steps: [step('a')] });
    const v2 = engine.save({ id: v1.id, name: 'v', steps: [step('a'), step('b')] });
    expect(v2.version).toBe(2);
    expect(engine.versions(v1.id).length).toBe(2);
  });

  it('recovers interrupted runs after a restart', async () => {
    engine.registerExecutor('tool', async () => 'x');
    const wf = engine.save({ name: 'rec', steps: [step('a'), step('b', ['a'])] });
    const run = engine.start(wf.id);
    await engine.wait(run.id);
    db.run("UPDATE workflow_runs SET status='running' WHERE id=?", [run.id]);
    const engine2 = new WorkflowEngine(db, bus, () => 'ws1');
    engine2.registerExecutor('tool', async () => 'x');
    expect(engine2.recover()).toBe(1);
    expect((await engine2.wait(run.id)).status).toBe('completed');
  });
});

describe('template helpers', () => {
  it('interpolates and evaluates conditions without eval', () => {
    const scope = { inputs: { n: 3 }, steps: { a: { output: { ok: true } } } };
    expect(interpolate('{{inputs.n}}', scope)).toBe(3);
    expect(interpolate('n={{inputs.n}}', scope)).toBe('n=3');
    expect(evalCondition('inputs.n > 2', scope)).toBe(true);
    expect(evalCondition('steps.a.output.ok == true', scope)).toBe(true);
    expect(evalCondition('process.exit(1)', scope)).toBe(false);
  });
});
