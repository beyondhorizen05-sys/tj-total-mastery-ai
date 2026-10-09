import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Fastify Server Injection Smoke Tests', () => {
  let serverInstance: Awaited<ReturnType<typeof createServer>>;
  const testDir = path.resolve('tests/tmp-smoke');

  beforeEach(async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const cfg = loadConfig({
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
    serverInstance = await createServer(cfg);
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

  it('keeps explicit connection testing usable under default privacy settings', async () => {
    const health = await serverInstance.app.inject({ method: 'POST', url: '/api/v1/connectors/slack_webhook/test', payload: {} });
    expect(health.statusCode).toBe(200);
    expect(health.json().ok).toBe(false);
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

  it('saves fast local recognition and keeps paid voice routing opt-in', async () => {
    const saved = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { voice_recognition_mode: 'fast', voice_use_default_model: false } });
    expect(saved.statusCode).toBe(200);
    const loaded = await serverInstance.app.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(loaded.json().settings).toMatchObject({ voice_recognition_mode: 'fast', voice_use_default_model: false });
    const invalid = await serverInstance.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { voice_recognition_mode: 'instant' } });
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
});

