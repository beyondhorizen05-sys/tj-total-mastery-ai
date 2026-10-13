import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Gemini Live Voice Configuration API Tests', () => {
  let serverInstance: Awaited<ReturnType<typeof createServer>>;
  let config: ReturnType<typeof loadConfig>;
  const testDir = path.resolve('tests/tmp-voice-live');

  beforeEach(async () => {
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

  it('returns default unconfigured status for Gemini Live', async () => {
    const res = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/voice/live/config',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.voice).toBe('Puck');
    expect(typeof body.configured).toBe('boolean');
  });

  it('stores Gemini Live API key in vault and updates selected voice', async () => {
    const putRes = await serverInstance.app.inject({
      method: 'PUT',
      url: '/api/v1/voice/live/config',
      payload: {
        api_key: 'AIzaSyFakeGeminiLiveTestKey_1234567890',
        voice: 'Charon',
      },
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.ok).toBe(true);
    expect(putBody.configured).toBe(true);
    expect(putBody.voice).toBe('Charon');

    const getRes = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/voice/live/config',
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.configured).toBe(true);
    expect(getBody.api_key).toBe('AIzaSyFakeGeminiLiveTestKey_1234567890');
    expect(getBody.voice).toBe('Charon');
  });

  it('updates selected voice without overwriting existing API key', async () => {
    await serverInstance.app.inject({
      method: 'PUT',
      url: '/api/v1/voice/live/config',
      payload: {
        api_key: 'AIzaSyFakeGeminiLiveTestKey_1234567890',
        voice: 'Aoede',
      },
    });

    const updateVoiceRes = await serverInstance.app.inject({
      method: 'PUT',
      url: '/api/v1/voice/live/config',
      payload: {
        voice: 'Kore',
      },
    });
    expect(updateVoiceRes.statusCode).toBe(200);

    const getRes = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/voice/live/config',
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.configured).toBe(true);
    expect(getBody.api_key).toBe('AIzaSyFakeGeminiLiveTestKey_1234567890');
    expect(getBody.voice).toBe('Kore');
  });

  it('allows clearing the API key with null', async () => {
    await serverInstance.app.inject({
      method: 'PUT',
      url: '/api/v1/voice/live/config',
      payload: {
        api_key: 'AIzaSyFakeGeminiLiveTestKey_1234567890',
        voice: 'Aoede',
      },
    });

    const clearRes = await serverInstance.app.inject({
      method: 'PUT',
      url: '/api/v1/voice/live/config',
      payload: {
        api_key: null,
      },
    });
    expect(clearRes.statusCode).toBe(200);

    const getRes = await serverInstance.app.inject({
      method: 'GET',
      url: '/api/v1/voice/live/config',
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.api_key).toBeNull();
    expect(getBody.configured).toBe(false);
  });
});
