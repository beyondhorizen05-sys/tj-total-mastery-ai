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

  it('does not replay an action whose outcome is unknown after a crash', async () => {
    engine.registerExecutor('tool', async () => 'original action');
    const wf = engine.save({ name: 'uncertain', steps: [step('send'), step('followup', ['send'])] });
    const run = engine.start(wf.id);
    await engine.wait(run.id);
    const state = engine.getRun(run.id)!.step_state;
    state.send.status = 'running';
    state.send.output = null;
    state.followup.status = 'pending';
    db.run('UPDATE workflow_runs SET status=?, step_state=?, completed_at=NULL WHERE id=?', ['running', JSON.stringify(state), run.id]);

    let replays = 0;
    const restarted = new WorkflowEngine(db, bus, () => 'ws1');
    restarted.registerExecutor('tool', async () => { replays++; return 'duplicate'; });
    expect(restarted.recover()).toBe(1);
    const recovered = restarted.getRun(run.id)!;
    expect(recovered.status).toBe('failed');
    expect(recovered.error).toContain('outcome is unknown');
    expect(recovered.step_state.send.status).toBe('failed');
    expect(recovered.step_state.followup.status).toBe('skipped');
    expect(replays).toBe(0);
  });

  it('recovers pending work using the saved workflow version', async () => {
    engine.registerExecutor('tool', async () => 'first');
    const v1 = engine.save({ name: 'versioned', steps: [step('original')] });
    const run = engine.start(v1.id);
    await engine.wait(run.id);
    const state = engine.getRun(run.id)!.step_state;
    state.original.status = 'pending';
    state.original.output = null;
    db.run('UPDATE workflow_runs SET status=?, step_state=?, completed_at=NULL WHERE id=?', ['queued', JSON.stringify(state), run.id]);
    engine.save({ id: v1.id, name: 'versioned', steps: [step('replacement')] });

    const executed: string[] = [];
    const restarted = new WorkflowEngine(db, bus, () => 'ws1');
    restarted.registerExecutor('tool', async (s) => { executed.push(s.id); return s.id; });
    expect(restarted.recover()).toBe(1);
    const recovered = await restarted.wait(run.id);
    expect(recovered.status).toBe('completed');
    expect(recovered.workflow_version).toBe(1);
    expect(executed).toEqual(['original']);
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
