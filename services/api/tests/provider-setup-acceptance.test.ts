import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server/app.js';
import { loadConfig } from '../src/config.js';

describe('custom provider setup lifecycle', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-provider-setup-'));
  const config = loadConfig({
    dataDir,
    dbPath: path.join(dataDir, 'tj.sqlite'),
    vaultPath: path.join(dataDir, 'vault'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    projectsDir: path.join(dataDir, 'projects'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    enableTestProvider: false,
    enableChatGPTPlanSignIn: false,
  });
  let app: Awaited<ReturnType<typeof createServer>>;
  let baseUrl: string;
  let failBeta = false;
  const receivedAuth: string[] = [];
  const mock = createHttpServer((req, res) => {
    receivedAuth.push(req.headers.authorization ?? '');
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const auth = req.headers.authorization;
        const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        const isFreeRouter = auth === 'Bearer freellm-router-key' && payload.model === 'auto';
        if (auth !== 'Bearer setup-alpha-key' && !isFreeRouter) {
          res.writeHead(401).end('Mock credential rejected');
          return;
        }
        if (payload.stream) {
          const model = isFreeRouter ? 'gemini-2.5-flash' : payload.model;
          const routedHeaders = isFreeRouter ? { 'x-routed-via': 'google/gemini-2.5-flash' } : {};
          const chunks = ['TJ_MODEL_', 'TEST_OK'].map((content) => `data: ${JSON.stringify({
            model, choices: [{ delta: { content }, finish_reason: null }],
          })}\n\n`).join('');
          res.writeHead(200, { 'content-type': 'text/event-stream', ...routedHeaders });
          res.end(`${chunks}data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 8, completion_tokens: 1 } })}\n\n` + 'data: [DONE]\n\n');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json', ...(isFreeRouter ? { 'x-routed-via': 'google/gemini-2.5-flash' } : {}) }).end(JSON.stringify({
          model: isFreeRouter ? 'gemini-2.5-flash' : payload.model,
          choices: [{ message: { role: 'assistant', content: 'TJ_MODEL_TEST_OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 8, completion_tokens: 1 },
        }));
      });
      return;
    }
    if (req.method !== 'GET' || req.url !== '/v1/models') {
      res.writeHead(404).end('Unknown mock route');
      return;
    }
    const auth = req.headers.authorization;
    if (auth === 'Bearer setup-alpha-key') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'alpha-chat', name: 'Alpha Chat', context_length: 8192 }] }));
    } else if (auth === 'Bearer setup-beta-key' && !failBeta) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'beta-chat', name: 'Beta Chat', context_length: 16384 }] }));
    } else if (auth === 'Bearer freellm-router-key') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', context_length: 1048576 }] }));
    } else if (!auth) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'keyless-local', name: 'Keyless Local', context_length: 4096 }] }));
    } else {
      res.writeHead(401).end('Mock credential rejected');
    }
  });

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      mock.once('error', reject);
      mock.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`;
    app = await createServer(config);
  });

  afterAll(async () => {
    if (app) {
      await app.app.close();
      app.db.close();
    }
    await new Promise<void>((resolve) => mock.close(() => resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('tests two custom providers, discovers their own models, and retains the selected default through failures and restart', async () => {
    const addProvider = async (name: string, apiKey: string) => {
      const response = await app.app.inject({
        method: 'POST', url: '/api/v1/models/providers',
        payload: { name, kind: 'openai-compatible', preset: null, base_url: baseUrl, api_key: apiKey },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(apiKey);
      return response.json() as { id: string; credential_ref: string };
    };

    const alpha = await addProvider('Local alpha router', 'setup-alpha-key');
    const beta = await addProvider('Local beta router', 'setup-beta-key');
    const keylessResponse = await app.app.inject({ method: 'POST', url: '/api/v1/models/providers', payload: {
      name: 'Keyless local router', kind: 'openai-compatible', preset: null, base_url: baseUrl,
    } });
    expect(keylessResponse.statusCode).toBe(200);
    const keyless = keylessResponse.json() as { id: string; credential_ref: string | null };
    expect(keyless.credential_ref).toBeNull();
    expect(alpha.id).not.toBe(beta.id);
    expect(alpha.credential_ref).toBeTruthy();
    expect(beta.credential_ref).toBeTruthy();

    for (const provider of [alpha, beta, keyless]) {
      const test = await app.app.inject({ method: 'POST', url: `/api/v1/models/providers/${provider.id}/test` });
      expect(test.statusCode).toBe(200);
      expect(test.json()).toMatchObject({ ok: true, status: 'CONNECTED' });
      const discovery = await app.app.inject({ method: 'POST', url: `/api/v1/models/providers/${provider.id}/refresh` });
      expect(discovery.statusCode).toBe(200);
      expect(discovery.json().models).toHaveLength(1);
    }
    const freeRouter = await addProvider('FreeLLM Local Router', 'freellm-router-key');
    const listedProviders = await app.app.inject({ method: 'GET', url: '/api/v1/models/providers' });
    expect(listedProviders.json().providers.find((provider: { id: string }) => provider.id === freeRouter.id)).toMatchObject({ privacy_class: 'cloud' });
    const freeRouterDiscovery = await app.app.inject({ method: 'POST', url: `/api/v1/models/providers/${freeRouter.id}/refresh` });
    expect(freeRouterDiscovery.statusCode).toBe(200);
    expect(freeRouterDiscovery.json().models.map((model: { model: string }) => model.model)).toEqual(['auto', 'gemini-2.5-flash']);
    const autoVerification = await app.app.inject({
      method: 'POST', url: '/api/v1/models/verify', payload: { model_id: `${freeRouter.id}/auto` },
    });
    expect(autoVerification.statusCode).toBe(200);
    expect(autoVerification.json()).toMatchObject({
      ok: true, model_id: `${freeRouter.id}/auto`, routed_via: 'google/gemini-2.5-flash',
      routed_model_id: `${freeRouter.id}/gemini-2.5-flash`,
    });
    const freeRouterModels = await app.app.inject({ method: 'GET', url: `/api/v1/models?provider_id=${freeRouter.id}` });
    expect(freeRouterModels.json().models.find((model: { model: string }) => model.model === 'auto')).toMatchObject({ health: 'healthy' });
    expect(freeRouterModels.json().models.find((model: { model: string }) => model.model === 'gemini-2.5-flash')).toMatchObject({ health: 'healthy', success_count: 1 });
    const conversation = await app.app.inject({ method: 'POST', url: '/api/v1/conversations', payload: { title: 'Auto route test' } });
    const conversationId = (conversation.json() as { id: string }).id;
    const chatRequest = app.app.inject({ method: 'POST', url: '/api/v1/chat', payload: {
      conversation_id: conversationId, content: 'Use the router auto route.', mode: 'chat', model_id: `${freeRouter.id}/auto`,
    } });
    // FreeLLM Auto may route to a billable cloud model, so the test simulates
    // the user explicitly approving the pending inference before it proceeds.
    let approvalId: string | undefined;
    for (let attempt = 0; attempt < 100 && !approvalId; attempt++) {
      const pending = await app.app.inject({ method: 'GET', url: '/api/v1/approvals?status=pending' });
      approvalId = pending.json().approvals.find((approval: { target: string; status: string }) =>
        approval.target === `${freeRouter.id}/auto` && approval.status === 'pending')?.id;
      if (!approvalId) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(approvalId, 'billable Auto route should wait for explicit user approval').toBeTruthy();
    const approved = await app.app.inject({
      method: 'POST', url: `/api/v1/approvals/${approvalId}/decide`, payload: { decision: 'approve_workflow' },
    });
    expect(approved.statusCode).toBe(200);
    const chat = await chatRequest;
    expect(chat.statusCode).toBe(200);
    expect(chat.json()).toMatchObject({
      model_id: `${freeRouter.id}/auto`, routed_via: 'google/gemini-2.5-flash',
      message: { trace: { routed_model_id: `${freeRouter.id}/gemini-2.5-flash`, routed_via: 'google/gemini-2.5-flash' } },
    });
    const streamedChat = await app.app.inject({
      method: 'POST', url: '/api/v1/chat', headers: { accept: 'text/event-stream' },
      payload: { conversation_id: conversationId, content: 'Stream this follow-up.', mode: 'chat', model_id: `${freeRouter.id}/auto` },
    });
    expect(streamedChat.statusCode).toBe(200);
    expect(streamedChat.headers['content-type']).toContain('text/event-stream');
    const streamEvents = streamedChat.body.split(/\r?\n\r?\n/).filter(Boolean);
    const deltas = streamEvents.filter((frame) => frame.startsWith('event: delta')).map((frame) => JSON.parse(frame.split(/\r?\n/).find((line) => line.startsWith('data: '))!.slice(6)).delta);
    const completion = streamEvents.find((frame) => frame.startsWith('event: done'));
    expect(deltas.join('')).toBe('TJ_MODEL_TEST_OK');
    expect(completion).toBeTruthy();
    expect(JSON.parse(completion!.split(/\r?\n/).find((line) => line.startsWith('data: '))!.slice(6))).toMatchObject({
      conversation_id: conversationId,
      content: 'TJ_MODEL_TEST_OK',
      message: { role: 'assistant', content: 'TJ_MODEL_TEST_OK', trace: { routed_via: 'google/gemini-2.5-flash' } },
    });
    const modelVerification = await app.app.inject({
      method: 'POST', url: '/api/v1/models/verify', payload: { model_id: `${alpha.id}/alpha-chat` },
    });
    expect(modelVerification.statusCode).toBe(200);
    expect(modelVerification.json()).toMatchObject({ ok: true, model_id: `${alpha.id}/alpha-chat`, provider_id: alpha.id });
    const verifiedModel = await app.app.inject({ method: 'GET', url: `/api/v1/models?provider_id=${alpha.id}` });
    expect(verifiedModel.json().models[0]).toMatchObject({ health: 'healthy', success_count: 1, failure_count: 0 });
    expect(receivedAuth).toEqual(expect.arrayContaining(['Bearer setup-alpha-key', 'Bearer setup-beta-key']));

    const modelIds = async (providerId: string) => {
      const response = await app.app.inject({ method: 'GET', url: `/api/v1/models?provider_id=${providerId}` });
      expect(response.statusCode).toBe(200);
      return (response.json() as { models: Array<{ id: string }> }).models.map((model) => model.id);
    };
    expect(await modelIds(alpha.id)).toEqual([`${alpha.id}/alpha-chat`]);
    expect(await modelIds(beta.id)).toEqual([`${beta.id}/beta-chat`]);
    expect(await modelIds(keyless.id)).toEqual([`${keyless.id}/keyless-local`]);

    const firstSelection = await app.app.inject({
      method: 'PATCH', url: '/api/v1/settings',
      payload: { default_model_id: `${alpha.id}/alpha-chat`, routing_mode: 'manual' },
    });
    expect(firstSelection.statusCode).toBe(200);
    expect(firstSelection.json().settings.default_model_id).toBe(`${alpha.id}/alpha-chat`);

    const defaultModel = `${beta.id}/beta-chat`;
    const selection = await app.app.inject({
      method: 'PATCH', url: '/api/v1/settings',
      payload: { default_model_id: defaultModel, routing_mode: 'manual' },
    });
    expect(selection.statusCode).toBe(200);
    expect(selection.json().settings).toMatchObject({ default_model_id: defaultModel, routing_mode: 'manual' });

    const invalidSelection = await app.app.inject({ method: 'PATCH', url: '/api/v1/settings', payload: { default_model_id: 42 } });
    expect(invalidSelection.statusCode).toBe(400);

    failBeta = true;
    const blockedModel = await app.app.inject({
      method: 'POST', url: '/api/v1/models/verify', payload: { model_id: `${beta.id}/beta-chat` },
    });
    expect(blockedModel.statusCode).toBe(200);
    expect(blockedModel.json()).toMatchObject({ ok: false, model_id: `${beta.id}/beta-chat`, stop_batch: true });
    expect(blockedModel.body).not.toContain('setup-beta-key');
    const failedTest = await app.app.inject({ method: 'POST', url: `/api/v1/models/providers/${beta.id}/test` });
    expect(failedTest.statusCode).toBe(200);
    expect(failedTest.json()).toMatchObject({ ok: false, status: 'UNAVAILABLE' });
    const failedDiscovery = await app.app.inject({ method: 'POST', url: `/api/v1/models/providers/${beta.id}/refresh` });
    expect(failedDiscovery.statusCode).toBe(401);

    const settingsAfterFailure = await app.app.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(settingsAfterFailure.json().settings).toMatchObject({ default_model_id: defaultModel, routing_mode: 'manual' });
    expect(await modelIds(beta.id)).toEqual([defaultModel]);

    await app.app.close();
    app.db.close();
    app = await createServer(config);
    const persistedSettings = await app.app.inject({ method: 'GET', url: '/api/v1/settings' });
    expect(persistedSettings.json().settings).toMatchObject({ default_model_id: defaultModel, routing_mode: 'manual' });
    expect(await modelIds(alpha.id)).toEqual([`${alpha.id}/alpha-chat`]);
    expect(await modelIds(beta.id)).toEqual([defaultModel]);
    const providers = await app.app.inject({ method: 'GET', url: '/api/v1/models/providers' });
    const storedBeta = providers.json().providers.find((provider: { id: string }) => provider.id === beta.id);
    expect(storedBeta).toMatchObject({ health: 'unauthorized' });
    expect(providers.body).not.toContain('setup-beta-key');
    const restoredMessages = await app.app.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}/messages` });
    expect(restoredMessages.statusCode).toBe(200);
    expect(restoredMessages.json().messages.map((message: { role: string }) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(restoredMessages.json().messages.at(-1)).toMatchObject({
      content: 'TJ_MODEL_TEST_OK',
      trace: { routed_via: 'google/gemini-2.5-flash' },
    });
  });
});
