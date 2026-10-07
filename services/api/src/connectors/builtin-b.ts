import type { ConnectorRuntime } from './sdk.js';
import { field, httpJson, manifest } from './sdk.js';

const haHeaders = (c: Record<string, string>) => ({ authorization: `Bearer ${c.token}`, 'content-type': 'application/json' });
const haBase = (c: Record<string, string>) => c.url.replace(/\/+$/, '');

export const homeAssistant: ConnectorRuntime = {
  manifest: manifest({
    id: 'home_assistant', name: 'Home Assistant', icon: '🏠', provider: 'Home Assistant', category: 'devices', description: 'Read entity states and call services on your Home Assistant instance.',
    auth_scheme: 'bearer', permissions: ['smart_home.control', 'connector.use'], scopes: ['states.read', 'services.call'], docs_url: 'https://www.home-assistant.io/docs/authentication/#your-account-profile',
    privacy: 'Talks only to your Home Assistant URL. Control actions require approval.',
    config_fields: [field('url', 'Base URL', false, true, 'e.g. http://homeassistant.local:8123', 'http://homeassistant.local:8123'), field('token', 'Long-lived access token', true, true)],
    actions: [
      { id: 'states', name: 'List states', description: 'All entity states', input_schema: { type: 'object', properties: {} }, risk: 'low' },
      { id: 'call_service', name: 'Call service', description: 'Call a service, e.g. light.turn_on', input_schema: { type: 'object', properties: { domain: { type: 'string' }, service: { type: 'string' }, data: { type: 'object' } }, required: ['domain', 'service'] }, risk: 'high' },
    ],
  }),
  async test(c) {
    try { const r = await httpJson(`${haBase(c)}/api/`, { headers: haHeaders(c), timeoutMs: 8000 }); return { ok: true, detail: r?.message ?? 'Connected' }; }
    catch (e: any) { return { ok: false, detail: `${e.message} (is Home Assistant reachable at ${c.url}?)` }; }
  },
  actions: {
    states: async (c) => ({ retrieved_at: new Date().toISOString(), states: await httpJson(`${haBase(c)}/api/states`, { headers: haHeaders(c) }) }),
    call_service: (c, i) => httpJson(`${haBase(c)}/api/services/${i.domain}/${i.service}`, { method: 'POST', headers: haHeaders(c), body: JSON.stringify(i.data ?? {}) }),
  },
};

export const slackWebhook: ConnectorRuntime = {
  manifest: manifest({
    id: 'slack_webhook', name: 'Slack (incoming webhook)', icon: '💬', provider: 'Slack', category: 'communication', description: 'Post messages to a Slack channel via an incoming webhook.',
    auth_scheme: 'custom', permissions: ['external.publish', 'connector.use'], scopes: ['incoming-webhook'], docs_url: 'https://api.slack.com/messaging/webhooks',
    privacy: 'Message text is posted to your Slack workspace. Sending requires approval.',
    config_fields: [field('webhook_url', 'Webhook URL', true, true, 'https://hooks.slack.com/services/…')],
    actions: [{ id: 'post', name: 'Post message', description: 'Send a message', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, risk: 'high' }],
  }),
  async test(c) {
    return /^https:\/\/hooks\.slack\.com\/services\//.test(c.webhook_url ?? '') ? { ok: true, detail: 'URL format valid (not tested to avoid posting a message)' } : { ok: false, detail: 'Not a Slack webhook URL' };
  },
  actions: { post: async (c, i) => { const res = await fetch(c.webhook_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: i.text }), signal: AbortSignal.timeout(15000) }); if (!res.ok) throw new Error(`Slack ${res.status}`); return { sent: true, status: res.status }; } },
};

export const genericWebhook: ConnectorRuntime = {
  manifest: manifest({
    id: 'generic_webhook', name: 'Generic webhook', icon: '🪝', provider: 'Custom', category: 'developer', description: 'POST JSON to any HTTPS endpoint you configure.',
    auth_scheme: 'custom', permissions: ['external.publish', 'connector.use'], scopes: [], privacy: 'Payloads go to the URL you set.',
    config_fields: [field('url', 'Endpoint URL', false, true, 'https://…'), field('auth_header', 'Authorization header (optional)', true, false)],
    actions: [{ id: 'post', name: 'POST JSON', description: 'Send a payload', input_schema: { type: 'object', properties: { payload: { type: 'object' } } }, risk: 'high' }],
  }),
  async test(c) { return /^https?:\/\//.test(c.url ?? '') ? { ok: true, detail: 'URL format valid' } : { ok: false, detail: 'URL must start with http(s)://' }; },
  actions: { post: async (c, i) => { const res = await fetch(c.url, { method: 'POST', headers: { 'content-type': 'application/json', ...(c.auth_header ? { authorization: c.auth_header } : {}) }, body: JSON.stringify(i.payload ?? {}), signal: AbortSignal.timeout(15000) }); const t = await res.text(); if (!res.ok) throw new Error(`HTTP ${res.status}: ${t.slice(0, 120)}`); return { status: res.status, body: t.slice(0, 2000) }; } },
};

/** Planned connectors are listed honestly with no runtime. */
export const PLANNED = [
  { id: 'google_calendar', name: 'Google Calendar', category: 'productivity', note: 'Requires OAuth2 client registration (Google Cloud project). Connector architecture is ready; OAuth app credentials needed.' },
  { id: 'gmail', name: 'Gmail', category: 'productivity', note: 'Requires OAuth2 client registration and Google verification for restricted scopes.' },
  { id: 'microsoft365', name: 'Microsoft 365 (Outlook/Calendar)', category: 'productivity', note: 'Requires an Azure AD app registration.' },
  { id: 'shopify', name: 'Shopify', category: 'business', note: 'Requires a Shopify custom app token.' },
  { id: 'alpaca', name: 'Alpaca (paper trading)', category: 'finance', note: 'Planned. Real-money trading additionally needs limits, kill switch and immutable audit log.' },
];
