import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Fastify Server Injection Smoke Tests', () => {
  let serverInstance: Awaited<ReturnType<typeof createServer>>;
  let config: ReturnType<typeof loadConfig>;
  const testDir = path.resolve('tests/tmp-smoke');

  beforeEach(async () => {
    // Recover cleanly when createServer previously failed before serverInstance was assigned.
    fs.rmSync(testDir, { recursive: true, force: true });
    fs.mkdirSync(testDir, { recursive: true });
    config = loadConfig({
      dataDir: testDir,
      dbPath: path.join(testDir, 'test.sqlite'),
      vaultPath: path.join(testDir, 'vault'),
      artifactsDir: path.join(testDir, 'artifacts'),
      projectsDir: path.join(testDir, 'projects'),
      backupsDir: path.join(testDir, 'backups'),
      logsDir: path.join(testDir, 'logs'),
      enableTestProvider: true,
      enableChatGPTPlanSignIn: false,
    });
    serverInstance = await createServer(config);
  });

  afterEach(async () => {
    try {
      await serverInstance.app.close();
      serverInstance.db.close();
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
  });

  it('GET /api/v1/system/status returns healthy system info', async () => {
    const res = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/system/status',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tj_state).toBeDefined();
    expect(body.version).toBe('2.0.0');
    expect(body.components).toBeDefined();
    expect(body.components.length).toBeGreaterThan(0);
    const voice = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/voice/status' });
    expect(body.microphone).toBe(!voice.json().available ? 'unknown' : voice.json().listening ? 'on' : 'off');
  });

  it('resets persisted agents whose task disappeared when the API restarts', async () => {
    const orphan = serverInstance.agentService.create({ workspace_id: 'default', name: 'Orphaned agent', role: 'developer' });
    serverInstance.agentService.setStatus(orphan.id, 'thinking', 'missing-task-after-restart');
    await serverInstance.app.close();
    serverInstance.db.close();

    serverInstance = await createServer(config);

    expect(serverInstance.agentService.get(orphan.id)).toMatchObject({ status: 'idle', current_task_id: null });
    const status = await serverInstance.health.getStatus();
    expect(status).toMatchObject({ active_agents: 0, tj_state: 'idle' });
  });

  it('GET /api/v1/connectors returns connector list and planned entries', async () => {
    const res = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/connectors',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.connectors)).toBe(true);
    expect(Array.isArray(body.planned)).toBe(true);
  });

  it('exposes the reviewed GitHub text playbooks in the local skill catalog', async () => {
    const catalog = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/skills/catalog' });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().catalog.map((entry: { manifest?: { id?: string } }) => entry.manifest?.id)).toEqual(expect.arrayContaining(['safe-binary-triage-plan', 'software-architecture-analysis']));
  });

  it('saves a custom provider when the form sends a null preset and a key', async () => {
    const res = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/models/providers',
      payload: { name: 'FreeLLM test', kind: 'openai-compatible', preset: null, base_url: 'http://127.0.0.1:31415/v1', api_key: 'disposable-test-key' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'FreeLLM test', kind: 'openai-compatible', base_url: 'http://127.0.0.1:31415/v1' });
    expect(res.body).not.toContain('disposable-test-key');
  });

  it('keeps ChatGPT plan sign-in gated until the development flag is enabled', async () => {
    const status = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/models/chatgpt-plan/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ enabled: false, pending: false, accounts: [] });
    const signIn = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/models/chatgpt-plan/sign-in', payload: {} });
    expect(signIn.statusCode).toBe(403);
    const forged = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/models/providers', payload: { name: 'Fake ChatGPT account', kind: 'chatgpt-plan' } });
    expect(forged.statusCode).toBe(400);
  });

  it('blocks self improvement while STOP ALL is engaged', async () => {
    await serverInstance.app.inject({ method: 'POST', url: '/api/v1/system/stop-all', payload: {} });
    const result = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/self-improvement/runs', payload: { prompt: 'Improve the welcome screen.' } });
    expect(result.statusCode).toBe(403);
  });

  it('deletes a chat and its messages, and returns 404 for an unknown chat', async () => {
    const created = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/conversations', payload: { title: 'Disposable chat' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    serverInstance.db.run('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)', ['message-for-delete-test', id, 'user', 'test message', new Date().toISOString()]);
    const deleted = await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/conversations/${id}` });
    expect(deleted.statusCode).toBe(200);
    expect(serverInstance.db.get('SELECT id FROM conversations WHERE id = ?', [id])).toBeUndefined();
    expect(serverInstance.db.get('SELECT id FROM messages WHERE conversation_id = ?', [id])).toBeUndefined();
    const missing = await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/conversations/${id}` });
    expect(missing.statusCode).toBe(404);
  });

  it('lets the user delete failed tasks but protects active or referenced tasks', async () => {
    const active = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/tasks', payload: { title: 'Active task' } });
    expect(active.statusCode).toBe(200);
    expect((await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/tasks/${active.json().id}` })).statusCode).toBe(409);

    const failed = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/tasks', payload: { title: 'Failed task' } });
    const failedId = failed.json().id as string;
    await serverInstance.app.inject({ method: 'PATCH', url: `/api/v1/tasks/${failedId}`, payload: { status: 'failed', error: 'Test failure' } });
    const dependent = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/tasks', payload: { title: 'Dependent task', depends_on: [failedId] } });
    const retained = await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/tasks/${failedId}` });
    expect(retained.statusCode).toBe(409);
    expect(retained.json().error).toMatch(/dependent task/i);

    await serverInstance.app.inject({ method: 'PATCH', url: `/api/v1/tasks/${dependent.json().id}`, payload: { status: 'blocked', error: 'Dependency failed' } });
    expect((await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/tasks/${dependent.json().id}` })).statusCode).toBe(200);
    expect((await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/tasks/${failedId}` })).statusCode).toBe(200);
    expect((await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/tasks/${failedId}` })).statusCode).toBe(404);
  });

  it('pauses and resumes tasks at safe checkpoints and exposes a persisted live execution trace', async () => {
    const created = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/tasks', payload: { title: 'Checkpoint task' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    serverInstance.taskService.setStage(id, 'Inspecting project files', 0.2, 'Reading the task inputs');
    const staged = await serverInstance.app.inject({ method: 'GET', url: `/api/v1/tasks/${id}` });
    expect(staged.json()).toMatchObject({ execution_stage: 'Inspecting project files', progress: 0.2 });
    expect(staged.json().execution_steps.at(-1)).toMatchObject({ stage: 'Inspecting project files', detail: 'Reading the task inputs' });

    const paused = await serverInstance.app.inject({ method: 'POST', url: `/api/v1/tasks/${id}/pause` });
    expect(paused.statusCode).toBe(200);
    expect(paused.json()).toMatchObject({ status: 'paused', execution_stage: 'Paused before execution' });
    let checkpointReleased = false;
    const checkpoint = serverInstance.taskService.checkpoint(id).then(() => { checkpointReleased = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(checkpointReleased).toBe(false);

    const resumed = await serverInstance.app.inject({ method: 'POST', url: `/api/v1/tasks/${id}/resume` });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ status: 'queued', execution_stage: 'Resumed; waiting for execution' });
    await checkpoint;
    expect(checkpointReleased).toBe(true);
    const terminal = await serverInstance.app.inject({ method: 'PATCH', url: `/api/v1/tasks/${id}`, payload: { status: 'completed' } });
    expect(terminal.statusCode).toBe(200);
    expect((await serverInstance.app.inject({ method: 'POST', url: `/api/v1/tasks/${id}/pause` })).statusCode).toBe(409);
  });

  it('registers bounded task recovery and exposes the GitHub inspector capability', async () => {
    const missing = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/tasks/missing-task/recover' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toBe('Task not found');
    const capabilities = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/system/capabilities' });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ capability_id: 'tools.github_repository', status: 'AVAILABLE' }),
    ]));
  });

  it('blocks connector health checks and actions in local-only privacy mode', async () => {
    const privacy = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { privacy_mode: 'local-only' } });
    expect(privacy.statusCode).toBe(200);
    const health = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/connectors/tavily/test', payload: {} });
    expect(health.statusCode).toBe(403);
    expect(health.json().error).toMatch(/Local-only/);
    const action = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/connectors/tavily/actions/search', payload: { query: 'example' } });
    expect(action.statusCode).toBe(403);
    expect(action.json().error).toMatch(/Local-only/);
  });

  it('bounds memory pages and reports deletion only when an item existed', async () => {
    const badItemsLimit = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/memory/items?limit=-1' });
    const badSearchLimit = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/memory/search?q=test&limit=100000' });
    expect(badItemsLimit.statusCode).toBe(400);
    expect(badSearchLimit.statusCode).toBe(400);

    const created = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/memory/items', payload: { type: 'preference', content: 'A removable test preference' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id as string;
    expect((await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/memory/items/${id}` })).statusCode).toBe(200);
    const missing = await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/memory/items/${id}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatch(/not found/i);
  });

  it('keeps explicit connection testing usable under default privacy settings', async () => {
    const health = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/connectors/slack_webhook/test', payload: {} });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(false);
  });

  it('exposes connected Gmail actions to TJ tools and gates sending on exact user approval', async () => {
    const send = serverInstance.tools.get('connector_gmail_send');
    const trash = serverInstance.tools.get('connector_gmail_trash');
    const read = serverInstance.tools.get('connector_gmail_read_message');
    expect(send).toMatchObject({ risk: 'high', permission: 'connector.use', permissions: expect.arrayContaining(['email.send', 'network.http']) });
    expect(trash).toMatchObject({ risk: 'critical', permissions: expect.arrayContaining(['email.delete', 'network.http']) });
    expect(read).toMatchObject({ risk: 'low' });
    await serverInstance.connectors.setConfig('gmail', { client_id: 'client', client_secret: 'secret', refresh_token: 'refresh' });

    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/token')) return new Response(JSON.stringify({ access_token: 'access' }));
      if (String(url).includes('/messages/send')) return new Response(JSON.stringify({ id: 'sent-1', threadId: 'thread-1' }));
      return new Response('unexpected request', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const execution = serverInstance.tools.execute('connector_gmail_send', { to: 'person@example.com', subject: 'Hello', body: 'Approved message' }, {
      workspace_id: 'default', project_id: null, project_root: null, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pending = serverInstance.approvals.list('pending').find((approval) => approval.action.includes('Gmail: Send email'));
    expect(pending).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
    serverInstance.approvals.decide(pending!.id, 'approve_once');
    const result = await execution;
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('honors a manifest permission deny before running a connector action', async () => {
    serverInstance.permissions.addPolicy({
      name: 'No publishing', permission: 'external.publish', resource: null, agent: null,
      decision: 'deny', scope: 'global', expires_at: null,
    });
    const action = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/connectors/slack_webhook/actions/post', payload: { text: 'do not send' },
    });
    expect(action.statusCode).toBe(403);
    expect(action.json().error).toMatch(/No publishing/);
  });

  it('validates permission-policy API input and rejects expired or malformed expiry rules', async () => {
    const valid = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/policies',
      payload: { name: 'Scoped read', permission: 'filesystem.read', resource: '/tmp/project/*', agent: null, decision: 'allow', scope: 'always', expires_at: null },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({ name: 'Scoped read', permission: 'filesystem.read', decision: 'allow' });

    const invalidDecision = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/policies',
      payload: { name: 'Invalid', permission: 'filesystem.read', decision: 'execute-anything' },
    });
    expect(invalidDecision.statusCode).toBe(400);

    const invalidExpiry = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/policies',
      payload: { name: 'Invalid expiry', permission: 'filesystem.read', resource: null, agent: null, decision: 'allow', scope: 'always', expires_at: 'not-a-date' },
    });
    expect(invalidExpiry.statusCode).toBe(400);
  });

  it('saves and returns a validated persistent TJ identity', async () => {
    const initial = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/persona' });
    expect(initial.statusCode).toBe(200);
    const persona = { ...initial.json().persona, embodiment: 'female', name: 'Nova', archetype: 'mentor', user_address: 'Jazib' };
    const saved = await serverInstance.app.inject({ method: 'PUT', url: '/api/v1/persona', payload: persona });
    expect(saved.statusCode).toBe(200);
    const loaded = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/persona' });
    expect(loaded.json().persona).toMatchObject({ embodiment: 'female', name: 'Nova', archetype: 'mentor', user_address: 'Jazib' });
    const invalid = await serverInstance.app.inject({ method: 'PUT', url: '/api/v1/persona', payload: { ...persona, embodiment: 'unknown' } });
    expect(invalid.statusCode).toBe(400);
    const browserOnlyVoice = await serverInstance.app.inject({ method: 'PUT', url: '/api/v1/persona', payload: { ...persona, voice_id: 'com.apple.voice.compact.en-US.Samantha' } });
    expect(browserOnlyVoice.statusCode).toBe(400);
    const afterInvalid = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/persona' });
    expect(afterInvalid.json().persona.embodiment).toBe('female');
  });

  it.skipIf(process.platform !== 'win32')('lists installed Windows voices for hands-free playback', async () => {
    const result = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/voice/windows/voices' });
    expect(result.statusCode).toBe(200);
    expect(result.json().voices).toEqual(expect.arrayContaining([expect.objectContaining({ name: expect.any(String), gender: expect.any(String) })]));
  });

  it('persists first-run profile and project storage while rejecting invalid paths', async () => {
    const profile = await serverInstance.app.inject({ method: 'PUT', url: '/api/v1/system/profile', payload: { display_name: 'Jazib', locale: 'en-US', time_zone: 'Asia/Dubai' } });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile.display_name).toBe('Jazib');
    const invalid = await serverInstance.app.inject({ method: 'PUT', url: '/api/v1/system/project-storage', payload: { directory: '.' } });
    expect(invalid.statusCode).toBe(400);
    const directory = path.join(testDir, 'selected-projects');
    const storage = await serverInstance.app.inject({ method: 'PUT', url: '/api/v1/system/project-storage', payload: { directory } });
    expect(storage.statusCode).toBe(200);
    const setup = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/system/setup' });
    expect(setup.json().profile.display_name).toBe('Jazib');
    expect(setup.json().storage.project_files_dir).toBe(path.resolve(directory));
    expect(fs.existsSync(directory)).toBe(true);
  });

  it('adds and removes a validated trusted file root and applies it to tool access immediately', async () => {
    const folder = path.join(testDir, 'trusted folder');
    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, 'notes.txt');
    fs.writeFileSync(target, 'trusted folder contents');

    const added = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/security/allowed-roots', payload: { path: folder } });
    expect(added.statusCode).toBe(201);
    const canonical = fs.realpathSync(folder);
    expect(added.json().roots).toContain(canonical);
    const duplicate = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/security/allowed-roots', payload: { path: folder } });
    expect(duplicate.statusCode).toBe(409);
    const filePath = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/security/allowed-roots', payload: { path: target } });
    expect(filePath.statusCode).toBe(400);
    const filesystemRoot = path.parse(canonical).root;
    const rootResult = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/security/allowed-roots', payload: { path: filesystemRoot } });
    expect(rootResult.statusCode).toBe(400);

    const tool = serverInstance.tools.get('fs_read')!;
    const context = { workspace_id: 'default', project_id: null, project_root: null, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null };
    expect(tool.requiresApproval?.({ path: target }, context)).toBe(false);
    const read = await serverInstance.tools.execute('fs_read', { path: target }, context);
    expect(read.ok).toBe(true);
    expect(read.output).toContain('trusted folder contents');
    expect(serverInstance.approvals.pendingCount()).toBe(0);

    const removed = await serverInstance.app.inject({ method: 'DELETE', url: `/api/v1/security/allowed-roots?path=${encodeURIComponent(canonical)}` });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().roots).not.toContain(canonical);
    expect(tool.requiresApproval?.({ path: target }, context)).toBe(true);
    const history = serverInstance.db.all<{ action: string; decision: string }>("SELECT action, decision FROM audit_log WHERE action LIKE 'filesystem.root.%'");
    expect(history.map((entry) => entry.action)).toEqual(expect.arrayContaining(['filesystem.root.add', 'filesystem.root.remove']));
  });

  it('persists a first-run hands-free opt-out after stopping voice', async () => {
    const enabled = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { voice_handsfree_mode: true } });
    expect(enabled.statusCode).toBe(200);
    const stopped = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/stop' });
    expect(stopped.statusCode).toBe(200);
    const disabled = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { voice_handsfree_mode: false } });
    expect(disabled.statusCode).toBe(200);
    const setup = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/system/setup' });
    expect(setup.json().settings).toMatchObject({ voice_autostart: false, voice_handsfree_mode: false });
  });

  it('keeps local computer commands off until explicitly enabled', async () => {
    const command = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ open notepad' } });
    expect(command.statusCode).toBe(200);
    expect(command.json().ok).toBe(false);
    expect(command.json().response).toMatch(/disabled/);
    const computer = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/computer/status' });
    expect(computer.json().enabled).toBe(false);
    const status = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/voice/status' });
    expect(status.json().listening).toBe(false);
  });

  it('accepts voice-only commands while Windows computer control is off', async () => {
    const command = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ stop listening' } });
    expect(command.json()).toMatchObject({ ok: true, response: 'Voice listening stopped.' });
  });

  it('allows conversation with computer control off', async () => {
    const candidates = vi.spyOn(serverInstance.router, 'candidates').mockReturnValue([{ id: 'mock-free' }] as any);
    const chat = vi.spyOn(serverInstance.router, 'chat').mockResolvedValue({ text: 'Hello from TJ.' } as any);
    try {
      const command = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ hello' } });
      expect(command.json()).toMatchObject({ ok: true, response: 'Hello from TJ.' });
      expect(chat).toHaveBeenCalledOnce();
    } finally { candidates.mockRestore(); chat.mockRestore(); }
  });

  it('exposes a safe voice interruption control and reports mic state', async () => {
    const before = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/voice/status' });
    const interrupted = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/interrupt' });
    expect(interrupted.statusCode).toBe(200);
    expect(interrupted.json()).toMatchObject({ ok: true, interrupted: true, voice: { listening: before.json().listening } });
  });

  it('keeps browser voice turns closed until a conversation starts', async () => {
    const turn = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/browser/turn', payload: { wav_base64: 'UklGRg==' } });
    expect(turn.statusCode).toBe(409);
    expect(turn.json().error).toMatch(/Start a voice conversation/);
    const speech = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/browser/synthesize', payload: { text: 'Hello there.' } });
    expect(speech.statusCode).toBe(409);
    const start = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/browser/start' });
    expect(start.statusCode).toBe(503);
    expect(start.json().error).toMatch(/local multilingual Whisper|Fish Audio/);
  });

  it('saves fast local recognition and keeps paid voice routing opt-in', async () => {
    const saved = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { voice_recognition_mode: 'fast', voice_use_default_model: false } });
    expect(saved.statusCode).toBe(200);
    const loaded = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(loaded.json().settings).toMatchObject({ voice_recognition_mode: 'fast', voice_use_default_model: false });
    const invalid = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { voice_recognition_mode: 'instant' } });
    expect(invalid.statusCode).toBe(400);
  });

  it('accepts autonomy levels 0–5 and rejects out-of-range values', async () => {
    for (const autonomy_level of [0, 5]) {
      const saved = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { autonomy_level } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().settings.autonomy_level).toBe(autonomy_level);
    }
    const invalid = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { autonomy_level: 6 } });
    expect(invalid.statusCode).toBe(400);
  });

  it.skipIf(process.platform !== 'win32')('observes the real focused Windows app through the voice command route', async () => {
    const enabled = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { computer_control_enabled: true } });
    expect(enabled.statusCode).toBe(200);
    const command = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ describe screen' } });
    expect(command.statusCode).toBe(200);
    expect(command.json().ok).toBe(true);
    expect(command.json().response).toMatch(/Focused window:/);
  });

  it.skipIf(process.platform !== 'win32')('returns the visual screen description from an explicitly requested vision tool', async () => {
    await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { computer_control_enabled: true, autonomy_level: 4 } });
    const visualTool = serverInstance.tools.get('computer_read_screen');
    expect(visualTool).toBeDefined();
    serverInstance.tools.register({ ...visualTool!, execute: async () => ({ ok: true, output: 'Visible text: TEST SCREEN' }) });
    const command = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ visually read the screen' } });
    expect(command.json()).toMatchObject({ ok: true, response: 'Visible text: TEST SCREEN' });
  });

  it.skipIf(process.platform !== 'win32')('answers a Roman Urdu local screen question without a model', async () => {
    await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { computer_control_enabled: true } });
    const observeTool = serverInstance.tools.get('computer_observe');
    expect(observeTool).toBeDefined();
    serverInstance.tools.register({ ...observeTool!, execute: async () => ({ ok: true, output: 'Focused app', data: { foreground: 'Notepad', elements: ['Edit: Salaam'] } }) });
    const command = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ screen par kya likha hai' } });
    expect(command.json().ok).toBe(true);
    expect(command.json().response).toMatch(/^Samne khuli window: Notepad/);
    expect(command.json().response).toContain('Edit: Salaam');
  });

  it('requires an action code for spoken approval and permits spoken denial', async () => {
    await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { computer_control_enabled: true } });
    const approval = serverInstance.approvals.request({ workspace_id: 'default', action: 'Click desktop', target: '100, 100', why: 'test', tools: ['computer_click'], resources_affected: [], risks: ['Could activate a control'], rollback_available: false, permission: 'computer.control', risk: 'medium' });
    const attempted = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ approve' } });
    expect(attempted.json().ok).toBe(false);
    expect(serverInstance.approvals.get(approval.id)?.status).toBe('pending');
    const denied = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/voice/command', payload: { text: 'TJ deny' } });
    expect(denied.json().ok).toBe(true);
    expect(serverInstance.approvals.get(approval.id)?.status).toBe('denied');
  });

  it('does not finish first-run setup without explicit completion', async () => {
    const initial = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/system/first-run' });
    expect(initial.json().first_run_completed).toBe(false);
    const invalid = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/system/first-run', payload: {} });
    expect(invalid.statusCode).toBe(400);
    const after = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/system/first-run' });
    expect(after.json().first_run_completed).toBe(false);
  });

  it('POST /api/v1/system/stop-all triggers emergency killswitch', async () => {
    const res = await serverInstance.app.inject({
      method: 'POST',
      url: '/api/v1/system/stop-all',
      payload: { reason: 'Smoke test stop-all' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.stopped).toBe(true);

    // Verify system status reflects stop-all active
    const statusRes = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/system/status',
    });
    const statusBody = statusRes.json();
    expect(statusBody.stop_all_engaged).toBe(true);
    expect(statusBody.tj_state).toBe('stopped');
  });

  it('STOP ALL cancels active workflows, denies their approvals, and blocks runs until resumed', async () => {
    const workflowResponse = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/workflows',
      payload: { name: 'STOP ALL approval gate', steps: [{ id: 'gate', name: 'Wait for approval', kind: 'approval', config: { action: 'Protected workflow action' }, risk: 'high' }] },
    });
    expect(workflowResponse.statusCode).toBe(200);
    const workflowId = workflowResponse.json().id as string;
    const automationResponse = await serverInstance.app.inject({
      method: 'POST', url: '/api/v1/automations',
      payload: { name: 'STOP ALL manual trigger', workflow_id: workflowId, enabled: true, trigger: { kind: 'manual', config: {} } },
    });
    expect(automationResponse.statusCode).toBe(200);
    const automationId = automationResponse.json().id as string;

    const runResponse = await serverInstance.app.inject({ method: 'POST', url: `/api/v1/workflows/${workflowId}/run`, payload: {} });
    expect(runResponse.statusCode).toBe(200);
    const runId = runResponse.json().id as string;
    const waitForPendingApproval = async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const approval = serverInstance.approvals.list('pending').find((item) => item.workflow_run_id === runId);
        if (approval) return approval;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('Workflow did not request its approval');
    };
    const firstApproval = await waitForPendingApproval();

    const stopped = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/system/stop-all', payload: {} });
    expect(stopped.statusCode).toBe(200);
    const cancelled = await serverInstance.workflowEngine.wait(runId);
    expect(cancelled.status).toBe('cancelled');
    expect(serverInstance.approvals.get(firstApproval.id)?.status).toBe('denied');
    expect(serverInstance.scheduler.isPaused()).toBe(true);
    expect((await serverInstance.app.inject({ method: 'POST', url: `/api/v1/workflows/${workflowId}/run`, payload: {} })).statusCode).toBe(403);
    expect((await serverInstance.app.inject({ method: 'POST', url: `/api/v1/automations/${automationId}/trigger`, payload: {} })).statusCode).toBe(403);

    const resumed = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/system/resume', payload: {} });
    expect(resumed.statusCode).toBe(200);
    expect(serverInstance.scheduler.isPaused()).toBe(false);
    const resumedRun = await serverInstance.app.inject({ method: 'POST', url: `/api/v1/workflows/${workflowId}/run`, payload: {} });
    expect(resumedRun.statusCode).toBe(200);
    const resumedRunId = resumedRun.json().id as string;
    for (let attempt = 0; attempt < 30 && !serverInstance.approvals.list('pending').some((item) => item.workflow_run_id === resumedRunId); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const stoppedAgain = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/system/stop-all', payload: {} });
    expect(stoppedAgain.statusCode).toBe(200);
    expect((await serverInstance.workflowEngine.wait(resumedRunId)).status).toBe('cancelled');
  });
});

