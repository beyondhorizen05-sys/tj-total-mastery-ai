import type { ConnectorRuntime } from './sdk.js';
import { field, httpJson, manifest } from './sdk.js';
const size = (value: unknown) => Math.min(10, Math.max(1, Math.floor(Number(value) || 5)));
export function localSearxngUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Only a localhost SearXNG instance is supported (e.g. http://127.0.0.1:8080)');
  }
  return url.origin;
}
export const searxng: ConnectorRuntime = {
  manifest: manifest({
    id: 'searxng', name: 'SearXNG local search', provider: 'Self-hosted SearXNG', category: 'search',
    description: 'Use your own SearXNG instance instead of a paid web-search API. Enable JSON output first.',
    docs_url: 'https://docs.searxng.org/dev/search_api.html', auth_scheme: 'none',
    permissions: ['network.http'], scopes: ['search'],
    privacy: 'Queries go to your localhost SearXNG; its upstream engines may receive them.',
    config_fields: [field('url', 'Local SearXNG base URL', false, true, 'A locally running JSON-enabled SearXNG', 'http://127.0.0.1:8080')],
    actions: [{ id: 'search', name: 'Search web', description: 'Web search from a local instance', risk: 'low',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } }],
  }),
  async test(c) {
    try {
      const url = new URL('/search', localSearxngUrl(c.url));
      url.search = new URLSearchParams({ q: 'test', format: 'json' }).toString();
      const data = await httpJson(url.href, { timeoutMs: 9000 });
      return { ok: Array.isArray(data.results), detail: Array.isArray(data.results) ? 'Local JSON search responded' : 'Enable JSON output in SearXNG' };
    } catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: {
    search: async (c, i) => {
      const query = String(i.query ?? '').trim();
      if (!query) throw new Error('Search query is required');
      const url = new URL('/search', localSearxngUrl(c.url));
      url.search = new URLSearchParams({ q: query.slice(0, 500), format: 'json' }).toString();
      const data = await httpJson(url.href);
      if (!Array.isArray(data.results)) throw new Error('SearXNG JSON output is unavailable');
      return { source: 'SearXNG self-hosted', fetched_at: new Date().toISOString(), results: data.results.slice(0, size(i.max_results)).map((r: any) => ({
        title: String(r.title ?? ''), url: String(r.url ?? ''), snippet: String(r.content ?? ''),
      })) };
    },
  },
};
export const openMeteo: ConnectorRuntime = {
  manifest: manifest({
    id: 'open_meteo', name: 'Open-Meteo weather', provider: 'Open-Meteo', category: 'realtime',
    description: 'Current weather without an API key; free hosted API is for non-commercial use only.',
    auth_scheme: 'none', docs_url: 'https://open-meteo.com/en/docs',
    permissions: ['network.http'], scopes: ['weather.read'],
    privacy: 'City search and weather coordinates are sent to Open-Meteo.',
    actions: [{ id: 'current', name: 'Current weather', description: 'Get city weather conditions', risk: 'low',
      input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }],
  }),
  async test() {
    try {
      const d = await httpJson('https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m', { timeoutMs: 9000 });
      return { ok: typeof d.current?.temperature_2m === 'number', detail: 'Open-Meteo keyless API check' };
    } catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: {
    current: async (_cfg, input) => {
      const city = String(input.city ?? '').trim();
      if (!city || city.length > 200) throw new Error('City must be 1–200 characters');
      const geo = new URL('https://geocoding-api.open-meteo.com/v1/search');
      geo.search = new URLSearchParams({ name: city, count: '1', format: 'json' }).toString();
      const location = (await httpJson(geo.href)).results?.[0];
      if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) throw new Error('City not found');
      const forecast = new URL('https://api.open-meteo.com/v1/forecast');
      forecast.search = new URLSearchParams({
        latitude: String(location.latitude), longitude: String(location.longitude),
        current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m', timezone: 'auto',
      }).toString();
      const d = await httpJson(forecast.href);
      return { source: 'Open-Meteo', retrieved_at: new Date().toISOString(),
        location: { name: location.name, country: location.country }, current: d.current, units: d.current_units,
        license_notice: 'Hosted free tier is non-commercial; commercial use requires appropriate terms' };
    },
  },
};
const wikipediaHeaders = {
  'user-agent': 'TJ-TotalMasteryAI/2.0 (https://github.com/beyondhorizen05-sys/tj-total-mastery-ai)',
  accept: 'application/json',
};
export const wikipedia: ConnectorRuntime = {
  manifest: manifest({
    id: 'wikipedia', name: 'Wikipedia encyclopedia', provider: 'Wikimedia', category: 'search',
    description: 'Keyless encyclopedia research with source links; not current news or general web search.',
    auth_scheme: 'none', docs_url: 'https://www.mediawiki.org/wiki/API:REST_API',
    permissions: ['network.http'], scopes: ['encyclopedia.read'],
    privacy: 'Search queries are transmitted to Wikimedia servers.',
    actions: [{ id: 'search', name: 'Search Wikipedia', description: 'Find encyclopedia articles', risk: 'low',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } }, required: ['query'] } }],
  }),
  async test() {
    try {
      const d = await httpJson('https://en.wikipedia.org/w/rest.php/v1/search/page?q=earth&limit=1', { headers: wikipediaHeaders, timeoutMs: 9000 });
      return { ok: Array.isArray(d.pages), detail: 'Wikipedia keyless API check' };
    } catch (e: any) { return { ok: false, detail: e.message }; }
  },
  actions: {
    search: async (_cfg, input) => {
      const query = String(input.query ?? '').trim();
      if (!query) throw new Error('Search query is required');
      const url = new URL('https://en.wikipedia.org/w/rest.php/v1/search/page');
      url.search = new URLSearchParams({ q: query.slice(0, 500), limit: String(size(input.max_results)) }).toString();
      const data = await httpJson(url.href, { headers: wikipediaHeaders });
      if (!Array.isArray(data.pages)) throw new Error('Wikipedia API response missing pages');
      return { source: 'Wikipedia (encyclopedia)', retrieved_at: new Date().toISOString(), results: data.pages.map((p: any) => ({
        title: String(p.title ?? ''), url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(p.key ?? p.title ?? '').replace(/ /g, '_')),
        snippet: String(p.excerpt ?? '').replace(/<[^>]*>/g, '').slice(0, 1000),
      })) };
    },
  },
};
