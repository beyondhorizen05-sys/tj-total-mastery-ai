import type { ConnectorRuntime } from './sdk.js';
import { field, httpJson, manifest } from './sdk.js';

export const tavily: ConnectorRuntime = {
  manifest: manifest({
    id: 'tavily', name: 'Tavily Search', icon: '🔎', provider: 'Tavily', category: 'search', description: 'Web search for research agents.', docs_url: 'https://app.tavily.com',
    permissions: ['network.http'], scopes: ['search'], privacy: 'Search queries are sent to Tavily.',
    config_fields: [field('api_key', 'API key', true, true, 'Create a key at app.tavily.com', 'tvly-…')],
    actions: [{ id: 'search', name: 'Search', description: 'Web search', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, risk: 'low' }],
  }),
  async test(c) {
    const t = performance.now();
    try { await httpJson('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.api_key}` }, body: JSON.stringify({ query: 'test', max_results: 1 }) }); return { ok: true, detail: 'Key accepted', latency_ms: Math.round(performance.now() - t) }; }
    catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: { search: (c, i) => httpJson('https://api.tavily.com/search', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${c.api_key}` }, body: JSON.stringify({ query: i.query, max_results: i.max_results ?? 5 }) }) },
};

export const brave: ConnectorRuntime = {
  manifest: manifest({
    id: 'brave_search', name: 'Brave Search', icon: '🦁', provider: 'Brave', category: 'search', description: 'Web search via Brave Search API.', docs_url: 'https://brave.com/search/api/',
    permissions: ['network.http'], scopes: ['search'], privacy: 'Search queries are sent to Brave.',
    config_fields: [field('api_key', 'API key', true, true, 'Get a key at brave.com/search/api')],
    actions: [{ id: 'search', name: 'Search', description: 'Web search', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, risk: 'low' }],
  }),
  async test(c) {
    const t = performance.now();
    try { await httpJson('https://api.search.brave.com/res/v1/web/search?q=test&count=1', { headers: { 'x-subscription-token': c.api_key, accept: 'application/json' } }); return { ok: true, detail: 'Key accepted', latency_ms: Math.round(performance.now() - t) }; }
    catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: { search: (c, i) => httpJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(i.query)}&count=${i.max_results ?? 5}`, { headers: { 'x-subscription-token': c.api_key, accept: 'application/json' } }) },
};

export const openweather: ConnectorRuntime = {
  manifest: manifest({
    id: 'openweather', name: 'OpenWeather', icon: '🌦️', provider: 'OpenWeather', category: 'realtime', description: 'Current weather with retrieval timestamp.', docs_url: 'https://openweathermap.org/api',
    permissions: ['network.http'], scopes: ['weather.read'], config_fields: [field('api_key', 'API key', true, true)],
    actions: [{ id: 'current', name: 'Current weather', description: 'Weather for a city', input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }, risk: 'low' }],
  }),
  async test(c) {
    try { await httpJson(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(c.api_key)}`); return { ok: true, detail: 'Key accepted' }; }
    catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: { current: async (c, i) => ({ retrieved_at: new Date().toISOString(), data: await httpJson(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(i.city)}&units=metric&appid=${encodeURIComponent(c.api_key)}`) }) },
};

export const github: ConnectorRuntime = {
  manifest: manifest({
    id: 'github', name: 'GitHub', icon: '🐙', provider: 'GitHub', category: 'development', description: 'Read repositories, issues and pull requests.', docs_url: 'https://github.com/settings/tokens',
    auth_scheme: 'bearer', permissions: ['connector.use', 'network.http'], scopes: ['repo:read (fine-grained token)'], privacy: 'Repository metadata is read with your token; the token is stored encrypted.',
    config_fields: [field('token', 'Personal access token', true, true, 'Use a fine-grained, read-only token')],
    actions: [
      { id: 'whoami', name: 'Authenticated user', description: 'Return the token owner', input_schema: { type: 'object', properties: {} }, risk: 'low' },
      { id: 'list_issues', name: 'List issues', description: 'Issues of owner/repo', input_schema: { type: 'object', properties: { repo: { type: 'string' } }, required: ['repo'] }, risk: 'low' },
    ],
  }),
  async test(c) {
    try { const u = await httpJson('https://api.github.com/user', { headers: { authorization: `Bearer ${c.token}`, 'user-agent': 'tj-total-mastery-ai', accept: 'application/vnd.github+json' } }); return { ok: true, detail: `Authenticated as ${u.login}` }; }
    catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: {
    whoami: (c) => httpJson('https://api.github.com/user', { headers: { authorization: `Bearer ${c.token}`, 'user-agent': 'tj-total-mastery-ai' } }),
    list_issues: (c, i) => httpJson(`https://api.github.com/repos/${i.repo}/issues?per_page=20`, { headers: { authorization: `Bearer ${c.token}`, 'user-agent': 'tj-total-mastery-ai' } }),
  },
};
