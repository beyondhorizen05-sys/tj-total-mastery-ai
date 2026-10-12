import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { Vault } from '../src/security/vault.js';
import { ConnectorService } from '../src/connectors/service.js';
import { EventBus } from '../src/core/event-bus.js';
import { WorkflowEngine } from '../src/workflows/engine.js';
import { AutomationScheduler } from '../src/workflows/automation-scheduler.js';
import { registerWorkflowRoutes } from '../src/server/routes/workflows.js';

describe('authorized weekday productivity briefing', () => {
  let db: Database;
  let connectors: ConnectorService;
  let vaultDir: string;
  beforeEach(() => {
    db = new Database(':memory:'); db.migrate();
    vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-google-test-'));
    connectors = new ConnectorService({ db, vault: new Vault(db, vaultDir) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
    fs.rmSync(vaultDir, { recursive: true, force: true });
  });

  it('reports missing OAuth setup and omits unauthorized external sources', async () => {
    expect((await connectors.get('google_calendar'))?.status).toBe('NEEDS_API_KEY');
    expect((await connectors.get('gmail'))?.status).toBe('NEEDS_API_KEY');
    expect(connectors.getPlanned().map((item) => item.id)).not.toContain('gmail');
    const missing = await connectors.test('google_calendar');
    expect(missing).toEqual({ ok: false, detail: 'Missing required fields: client_id, client_secret, refresh_token' });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const result = await connectors.execute('tj_productivity', 'weekday_summary', { now: '2026-10-08T04:00:00.000Z' }) as any;
    expect(result.partial).toBe(true);
    expect(result.sources.calendar.status).toBe('not_connected');
    expect(result.sources.email.status).toBe('not_connected');
    expect(result.summary).toContain('not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes tokens, reads events and important message metadata, then assembles a real briefing', async () => {
    const config = { client_id: 'client-id', client_secret: 'client-secret', refresh_token: 'refresh-token' };
    await connectors.setConfig('google_calendar', config);
    await connectors.setConfig('gmail', config);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit) => {
      const target = String(url); calls.push(target);
      if (target.includes('/token')) {
        expect(String(init.body)).toContain('grant_type=refresh_token');
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
      }
      expect((init.headers as any).authorization).toBe('Bearer access-token');
      if (target.includes('/profile')) return new Response(JSON.stringify({ emailAddress: 'test@example.com' }));
      if (target.includes('/calendars/primary/events')) return new Response(JSON.stringify({ items: [{ id: 'ev1', summary: 'Design review', start: { dateTime: '2026-10-08T08:00:00Z' }, end: { dateTime: '2026-10-08T09:00:00Z' } }] }));
      if (target.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'msg1' }], resultSizeEstimate: 1 }));
      if (target.includes('/messages/msg1?')) return new Response(JSON.stringify({ id: 'msg1', threadId: 'thread1', snippet: 'Please review', payload: { headers: [{ name: 'Subject', value: 'Deadline' }, { name: 'From', value: 'Alex <alex@example.com>' }, { name: 'Date', value: 'Thu, 8 Oct 2026' }] } }));
      return new Response('not found', { status: 404 });
    }));
    expect((await connectors.test('google_calendar')).ok).toBe(true);
    expect((await connectors.test('gmail')).ok).toBe(true);
    expect((await connectors.get('google_calendar'))?.status).toBe('CONNECTED');
    db.run(`INSERT INTO tasks (id, workspace_id, title, status, created_at) VALUES (?,?,?,?,?)`, ['task1', 'default', 'Finish prototype', 'running', new Date().toISOString()]);
    const result = await connectors.execute('tj_productivity', 'weekday_summary', { now: '2026-10-08T04:00:00.000Z' }) as any;
    expect(result.partial).toBe(false);
    expect(result.sources.calendar.status).toBe('ok');
    expect(result.events[0].title).toBe('Design review');
    expect(result.messages[0].subject).toBe('Deadline');
    expect(result.tasks[0].title).toBe('Finish prototype');
    expect(result.summary).toContain('Deadline from Alex');
    expect(calls.some((url) => url.includes('timeMin=2026-10-08T04%3A00%3A00.000Z'))).toBe(true);
    expect(calls.some((url) => url.includes('q=is%3Aimportant'))).toBe(true);
  });

  it('keeps a coherent summary when one connected source fails', async () => {
    const config = { client_id: 'a', client_secret: 'b', refresh_token: 'c' };
    await connectors.setConfig('google_calendar', config);
    await connectors.setConfig('gmail', config);
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.includes('/token')) return new Response(JSON.stringify({ access_token: 'token' }));
      if (target.includes('/profile')) return new Response(JSON.stringify({ emailAddress: 'test@example.com' }));
      if (target.includes('/calendars/primary/events')) return new Response(JSON.stringify({ items: [] }));
      if (target.includes('/messages?')) return new Response(JSON.stringify({ messages: [] }));
      return new Response('not found', { status: 404 });
    }));
    expect((await connectors.test('google_calendar')).ok).toBe(true);
    expect((await connectors.test('gmail')).ok).toBe(true);
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.includes('/token')) return new Response(JSON.stringify({ access_token: 'token' }));
      if (target.includes('/calendars/primary/events')) return new Response('offline', { status: 503 });
      if (target.includes('/messages?')) return new Response(JSON.stringify({ messages: [] }));
      return new Response('not found', { status: 404 });
    }));
    const result = await connectors.execute('tj_productivity', 'weekday_summary', {}) as any;
    expect(result.partial).toBe(true);
    expect(result.sources.calendar.status).toBe('error');
    expect(result.sources.email.status).toBe('ok');
    expect(result.summary).toContain('temporarily unavailable');
  });

  it('retries one transient Google read failure without retrying an OAuth rejection', async () => {
    const config = { client_id: 'a', client_secret: 'b', refresh_token: 'c' };
    await connectors.setConfig('google_calendar', config);
    let eventReads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const target = String(url);
      if (target.includes('/token')) return new Response(JSON.stringify({ access_token: 'token' }));
      if (target.includes('/events')) {
        eventReads++;
        if (eventReads === 2) return new Response('rate limited', { status: 429 });
        return new Response(JSON.stringify({ items: [{ id: 'event', summary: 'Recovered' }] }));
      }
      return new Response('not found', { status: 404 });
    }));
    expect((await connectors.test('google_calendar')).ok).toBe(true);
    const result = await connectors.execute('tj_productivity', 'weekday_summary', { now: '2026-10-08T04:00:00.000Z' }) as any;
    expect(eventReads).toBe(3);
    expect(result.sources.calendar.status).toBe('ok');
    expect(result.events[0].title).toBe('Recovered');
    expect(result.sources.email.status).toBe('not_connected');

    let rejectedReads = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'token' }));
      rejectedReads++;
      return new Response('unauthorized', { status: 401 });
    }));
    const rejected = await connectors.execute('tj_productivity', 'weekday_summary', {}) as any;
    expect(rejectedReads).toBe(1);
    expect(rejected.sources.calendar.status).toBe('error');
  });

  it('reads a Gmail body and implements send and reversible Trash actions', async () => {
    const config = { client_id: 'client-id', client_secret: 'client-secret', refresh_token: 'refresh-token' };
    await connectors.setConfig('gmail', config);
    const requests: Array<{ url: string; method: string; body?: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      const target = String(url);
      const method = init.method ?? 'GET';
      if (target.includes('/token')) return new Response(JSON.stringify({ access_token: 'access-token' }));
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ url: target, method, body });
      if (target.includes('/messages/message-1?format=full')) return new Response(JSON.stringify({
        id: 'message-1', threadId: 'thread-1', snippet: 'hello',
        payload: { headers: [{ name: 'From', value: 'sender@example.com' }, { name: 'Subject', value: 'Test' }], mimeType: 'text/plain', body: { data: Buffer.from('Hello from Gmail').toString('base64url') } },
      }));
      if (target.endsWith('/messages/send')) return new Response(JSON.stringify({ id: 'sent-1', threadId: 'thread-2' }));
      if (target.endsWith('/messages/message-1/trash')) return new Response(JSON.stringify({ id: 'message-1', labelIds: ['TRASH'] }));
      return new Response('unexpected request', { status: 404 });
    }));

    const read = await connectors.execute('gmail', 'read_message', { message_id: 'message-1' }) as any;
    expect(read).toMatchObject({ id: 'message-1', subject: 'Test', body: 'Hello from Gmail', content_trust: 'untrusted_email_content' });
    const sent = await connectors.execute('gmail', 'send', { to: 'person@example.com', subject: 'Approved subject', body: 'Approved body' }) as any;
    expect(sent).toMatchObject({ id: 'sent-1', status: 'sent' });
    const sendRequest = requests.find((request) => request.url.endsWith('/messages/send'))!;
    expect(sendRequest.method).toBe('POST');
    expect(Buffer.from(sendRequest.body.raw, 'base64url').toString('utf8')).toContain('Approved body');
    const trashed = await connectors.execute('gmail', 'trash', { message_id: 'message-1' }) as any;
    expect(trashed).toMatchObject({ id: 'message-1', status: 'moved_to_trash' });
    expect(requests.find((request) => request.url.endsWith('/messages/message-1/trash'))?.method).toBe('POST');
    expect((await connectors.get('gmail'))?.scopes).toEqual([
      'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send',
    ]);
  });

  it('creates a disabled 8 AM weekday automation only through explicit request, with valid timezone', async () => {
    const app = Fastify();
    const bus = new EventBus(db);
    const engine = new WorkflowEngine(db, bus, () => 'default');
    engine.registerExecutor('connector', async (step) => connectors.execute(String(step.config.connector_id), String(step.config.action), (step.config.input as Record<string, any>) ?? {}));
    const scheduler = new AutomationScheduler({ db, engine, bus });
    registerWorkflowRoutes(app, { engine, scheduler });
    const bad = await app.inject({ method: 'POST', url: '/api/v1/automations/weekday-summary', payload: { timezone: 'Mars/Olympus' } });
    expect(bad.statusCode).toBe(400);
    expect(engine.list()).toHaveLength(0);
    const response = await app.inject({ method: 'POST', url: '/api/v1/automations/weekday-summary', payload: { timezone: 'Asia/Dubai' } });
    expect(response.statusCode).toBe(201);
    const saved = response.json();
    expect(saved.enabled).toBe(false);
    expect(saved.next_run_at).toBeNull();
    const automation = scheduler.get(saved.automation_id)!;
    expect(automation.trigger.config).toEqual({ cron: '0 8 * * 1-5', timezone: 'Asia/Dubai' });
    expect(engine.get(saved.workflow_id)?.steps[0].config).toEqual({ connector_id: 'tj_productivity', action: 'weekday_summary', input: {} });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const runId = await scheduler.trigger(saved.automation_id, 'manual_test');
    const run = await engine.wait(runId!);
    expect(run.status).toBe('completed');
    expect((run.step_state.briefing.output as any).sources.calendar.status).toBe('not_connected');
    expect(engine.listRuns({ workflow_id: saved.workflow_id })).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const enabled = scheduler.save({ id: saved.automation_id, name: automation.name, enabled: true, workflow_id: saved.workflow_id, trigger: automation.trigger });
    const next = new Date(scheduler.get(enabled.id)!.next_run_at!);
    const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', weekday: 'short' }).format(next);
    expect(local).toMatch(/08:00/);
    expect(local).toMatch(/Mon|Tue|Wed|Thu|Fri/);
    scheduler.stop(); await app.close();
  });

  it('dispatches the weekday briefing at 08:00 Dubai time and records its output', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-09T03:59:50.000Z')); // Friday, 07:59:50 in Dubai
    try {
      const bus = new EventBus(db);
      const engine = new WorkflowEngine(db, bus, () => 'default');
      engine.registerExecutor('connector', async (step) => connectors.execute(String(step.config.connector_id), String(step.config.action), (step.config.input as Record<string, any>) ?? {}));
      const scheduler = new AutomationScheduler({ db, engine, bus });
      const workflow = engine.save({
        name: 'Scheduled briefing acceptance',
        steps: [{ id: 'briefing', name: 'Briefing', kind: 'connector', depends_on: [],
          config: { connector_id: 'tj_productivity', action: 'weekday_summary', input: {} },
          retry: { max_attempts: 1, backoff_ms: 1000, max_backoff_ms: 1000 }, timeout_ms: 120000,
          permissions: ['network.http'], risk: 'low', continue_on_error: false }],
      });
      const auto = scheduler.save({ name: 'Friday briefing', workflow_id: workflow.id,
        trigger: { kind: 'schedule', config: { cron: '0 8 * * 1-5', timezone: 'Asia/Dubai' } } });
      expect(auto.next_run_at).toBe('2026-10-09T04:00:00.000Z');
      await vi.advanceTimersByTimeAsync(10_000);
      const runs = engine.listRuns({ workflow_id: workflow.id });
      expect(runs).toHaveLength(1);
      const completed = await engine.wait(runs[0].id);
      expect(completed.status).toBe('completed');
      expect((completed.step_state.briefing.output as any).sources.calendar.status).toBe('not_connected');
      expect((completed.step_state.briefing.output as any).sources.email.status).toBe('not_connected');
      expect(scheduler.get(auto.id)?.run_count).toBe(1);
      expect(scheduler.get(auto.id)?.next_run_at).toBe('2026-10-12T04:00:00.000Z'); // Monday
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
