import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerVisionRoutes } from '../src/server/routes/vision.js';
import type { ModelRouter } from '../src/models/router.js';
import type { SettingsRepo } from '../src/db/repo.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZVQAAAAASUVORK5CYII=';
const local = { id: 'ollama/local-vision', display_name: 'Local Vision', provider_id: 'ollama', privacy_class: 'local', cost_class: 'free' };
const cloud = { id: 'cloud/vision', display_name: 'Cloud Vision', provider_id: 'cloud', privacy_class: 'cloud', cost_class: 'low' };

function setup(privacyMode = 'balanced') {
  const app = Fastify();
  const candidates = vi.fn().mockReturnValue([local, cloud]);
  const chat = vi.fn().mockResolvedValue({ text: 'A small white square.', model_id: local.id, provider_id: 'ollama', cost_usd: 0, finish_reason: 'stop' });
  const settings = { get: vi.fn().mockReturnValue(privacyMode) } as unknown as SettingsRepo;
  registerVisionRoutes(app, { router: { candidates, chat } as unknown as ModelRouter, settings });
  return { app, candidates, chat };
}

describe('explicit vision upload', () => {
  it('sends the uploaded image to the exact selected vision model and returns its answer', async () => {
    const { app, candidates, chat } = setup();
    const response = await app.inject({ method: 'POST', url: '/api/v1/vision/analyze', payload: { image_data_url: image, question: 'What is shown?', model_id: local.id } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ answer: 'A small white square.', model_id: local.id, provider_id: 'ollama' });
    expect(response.body).not.toContain('base64');
    expect(candidates).toHaveBeenCalledWith({ task_type: 'vision', needs_vision: true });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toMatchObject({ task_type: 'vision', needs_vision: true, model_id: local.id });
    expect(chat.mock.calls[0][1].messages[1].content[1].image_url).toBe(image);
    await app.close();
  });

  it('does not transmit a cloud image in local-only privacy mode', async () => {
    const { app, chat } = setup('local-only');
    const status = await app.inject({ method: 'GET', url: '/api/v1/vision/status' });
    expect(status.json()).toMatchObject({ privacy_mode: 'local-only', models: [{ id: local.id }] });
    expect(status.json().models).toHaveLength(1);
    const response = await app.inject({ method: 'POST', url: '/api/v1/vision/analyze', payload: { image_data_url: image, model_id: cloud.id } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('local-only');
    expect(chat).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects invalid images and unselected models before calling the provider', async () => {
    const { app, chat } = setup();
    const fake = await app.inject({ method: 'POST', url: '/api/v1/vision/analyze', payload: { image_data_url: 'data:image/png;base64,ZmFrZQ==', model_id: local.id } });
    expect(fake.statusCode).toBe(400);
    const missing = await app.inject({ method: 'POST', url: '/api/v1/vision/analyze', payload: { image_data_url: image } });
    expect(missing.statusCode).toBe(400);
    expect(chat).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns a failure when the provider cannot analyze the image', async () => {
    const { app, chat } = setup();
    chat.mockResolvedValueOnce({ text: '', model_id: local.id, provider_id: 'ollama', finish_reason: 'error' });
    const response = await app.inject({ method: 'POST', url: '/api/v1/vision/analyze', payload: { image_data_url: image, model_id: local.id } });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toContain('did not return');
    await app.close();
  });
});
