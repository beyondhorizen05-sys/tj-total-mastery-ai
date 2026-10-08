import type { ConnectorRuntime } from './sdk.js';
import { field, manifest } from './sdk.js';

const tokenEndpoint = 'https://oauth2.googleapis.com/token';
const calendarEndpoint = 'https://www.googleapis.com/calendar/v3';
const gmailEndpoint = 'https://gmail.googleapis.com/gmail/v1';

/** A refresh token is supplied by the user after consenting to the indicated read scope. */
async function accessToken(config: Record<string, string>): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.client_id,
    client_secret: config.client_secret,
    refresh_token: config.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetch(tokenEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google OAuth refresh failed (HTTP ${response.status}). Check OAuth client, consent, scope and refresh token.`);
  const value = await response.json() as { access_token?: string };
  if (!value.access_token) throw new Error('Google OAuth refresh returned no access token. Re-authorize this connector.');
  return value.access_token;
}

async function googleGet(config: Record<string, string>, url: URL): Promise<any> {
  const token = await accessToken(config);
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok || attempt >= 1 || (response.status !== 429 && response.status < 500)) break;
    // Google read endpoints are idempotent. Keep the retry short so a briefing
    // still completes promptly when a provider remains unavailable.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!response.ok) {
    const reason = response.status === 401 ? 'OAuth token was rejected; reconnect this account.'
      : response.status === 403 ? 'Insufficient Google API scope or API access denied.'
      : 'Google API request failed.';
    throw new Error(`${reason} HTTP ${response.status}`);
  }
  return response.json();
}

const oauthFields = [
  field('client_id', 'Google OAuth client ID', false, true, 'Create an OAuth client in Google Cloud Console.'),
  field('client_secret', 'Google OAuth client secret', true, true),
  field('refresh_token', 'OAuth refresh token', true, true, 'Authorize the read-only scope with offline access; paste the resulting refresh token.'),
];

function limit(value: unknown, fallback: number, ceiling: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? Math.min(number, ceiling) : fallback;
}

export const googleCalendar: ConnectorRuntime = {
  manifest: manifest({
    id: 'google_calendar', name: 'Google Calendar', icon: '📅', provider: 'Google', category: 'productivity',
    description: 'Read upcoming events from a calendar authorized by its owner.',
    auth_scheme: 'oauth2', permissions: ['connector.use', 'network.http'],
    scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
    privacy: 'Calendar events are read from Google using your OAuth refresh token. No event changes are made.',
    docs_url: 'https://developers.google.com/calendar/api/guides/auth', config_fields: oauthFields,
    actions: [{ id: 'upcoming', name: 'Upcoming events', description: 'Read events in a time range', risk: 'low',
      input_schema: { type: 'object', properties: { calendar_id: { type: 'string' }, time_min: { type: 'string' }, time_max: { type: 'string' }, max_results: { type: 'integer' } } } }],
  }),
  async test(config) {
    const start = performance.now();
    try {
      const url = new URL(`${calendarEndpoint}/calendars/primary/events`);
      url.searchParams.set('timeMin', new Date().toISOString());
      url.searchParams.set('maxResults', '1');
      await googleGet(config, url);
      return { ok: true, detail: 'Google Calendar read access verified', latency_ms: Math.round(performance.now() - start) };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : 'Google Calendar test failed' }; }
  },
  actions: {
    upcoming: async (config, input) => {
      const min = new Date(input.time_min ?? Date.now());
      const max = new Date(input.time_max ?? min.getTime() + 24 * 60 * 60 * 1000);
      if (Number.isNaN(min.getTime()) || Number.isNaN(max.getTime()) || max <= min) throw new Error('Calendar requires valid time_min before time_max');
      const calendarId = String(input.calendar_id ?? 'primary');
      const url = new URL(`${calendarEndpoint}/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('timeMin', min.toISOString());
      url.searchParams.set('timeMax', max.toISOString());
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('orderBy', 'startTime');
      url.searchParams.set('maxResults', String(limit(input.max_results, 20, 100)));
      const data = await googleGet(config, url);
      return { retrieved_at: new Date().toISOString(), calendar_id: calendarId, events: (data.items ?? []).map((event: any) => ({
        id: event.id, title: event.summary ?? '(untitled)', start: event.start?.dateTime ?? event.start?.date,
        end: event.end?.dateTime ?? event.end?.date, location: event.location ?? null, status: event.status,
      })) };
    },
  },
};

export const gmail: ConnectorRuntime = {
  manifest: manifest({
    id: 'gmail', name: 'Gmail', icon: '✉️', provider: 'Google', category: 'productivity',
    description: 'Read important message metadata from an authorized Gmail account.',
    auth_scheme: 'oauth2', permissions: ['connector.use', 'network.http'],
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    privacy: 'Message metadata and snippets are read from Google. No email is sent, modified or deleted.',
    docs_url: 'https://developers.google.com/workspace/gmail/api/auth/scopes', config_fields: oauthFields,
    actions: [{ id: 'important', name: 'Important email', description: 'Read important inbox message subjects, senders and snippets', risk: 'low',
      input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'integer' } } } }],
  }),
  async test(config) {
    const start = performance.now();
    try {
      await googleGet(config, new URL(`${gmailEndpoint}/users/me/profile`));
      return { ok: true, detail: 'Gmail read access verified', latency_ms: Math.round(performance.now() - start) };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : 'Gmail test failed' }; }
  },
  actions: {
    important: async (config, input) => {
      const max = limit(input.max_results, 10, 30);
      const url = new URL(`${gmailEndpoint}/users/me/messages`);
      url.searchParams.set('q', String(input.query ?? 'is:important newer_than:7d'));
      url.searchParams.set('maxResults', String(max));
      const result = await googleGet(config, url);
      const refs = Array.isArray(result.messages) ? result.messages.slice(0, max) : [];
      const messages = await Promise.all(refs.map(async (ref: { id: string }) => {
        const detailUrl = new URL(`${gmailEndpoint}/users/me/messages/${encodeURIComponent(ref.id)}`);
        detailUrl.searchParams.set('format', 'metadata');
        for (const header of ['Subject', 'From', 'Date']) detailUrl.searchParams.append('metadataHeaders', header);
        const detail = await googleGet(config, detailUrl);
        const headers = Object.fromEntries((detail.payload?.headers ?? []).map((header: any) => [String(header.name).toLowerCase(), header.value]));
        return { id: detail.id, thread_id: detail.threadId, subject: headers.subject ?? '(no subject)',
          from: headers.from ?? '', date: headers.date ?? '', snippet: detail.snippet ?? '', labels: detail.labelIds ?? [] };
      }));
      return { retrieved_at: new Date().toISOString(), messages, result_size_estimate: result.resultSizeEstimate ?? messages.length };
    },
  },
};
