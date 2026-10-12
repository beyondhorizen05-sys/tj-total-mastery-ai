import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeAssistant } from '../src/connectors/builtin-b.js';

describe('Home Assistant connector URL boundaries', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a configured base and rejects path-changing service names before network access', async () => {
    const fetchMock = vi.fn(async (_url: string | URL) => new Response(JSON.stringify({ success: true })));
    vi.stubGlobal('fetch', fetchMock);
    const config = { url: 'http://homeassistant.local:8123/', token: 'secret' };
    await homeAssistant.actions.call_service(config, { domain: 'light', service: 'turn_on', data: { entity_id: 'light.desk' } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://homeassistant.local:8123/api/services/light/turn_on');
    expect(() => homeAssistant.actions.call_service(config, { domain: 'light/../config', service: 'turn_on' })).toThrow('Invalid Home Assistant domain');
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(homeAssistant.actions.states({ url: 'http://user:password@homeassistant.local/', token: 'secret' }, {})).rejects.toThrow('without credentials');
    expect(fetchMock).toHaveBeenCalledOnce();
    const failedTest = await homeAssistant.test({ url: 'http://user:password@homeassistant.local/', token: 'secret' });
    expect(failedTest.ok).toBe(false);
    expect(failedTest.detail).not.toContain('password');
  });
});
