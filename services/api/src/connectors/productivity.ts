import type { Database } from '../db/database.js';
import type { ConnectorService } from './service.js';
import type { ConnectorRuntime } from './sdk.js';
import { manifest } from './sdk.js';

const activeStates = ['queued', 'analyzing', 'waiting', 'running', 'retrying', 'awaiting_approval', 'paused'];

/** Deterministic briefing: no model credits, and each source is labelled by its actual state. */
export function createProductivityConnector(service: ConnectorService, db: Database): ConnectorRuntime {
  return {
    manifest: manifest({
      id: 'tj_productivity', name: 'TJ Productivity Briefing', icon: '🗓️', provider: 'TJ', category: 'productivity',
      description: 'Summarize connected calendar, important email and active TJ tasks.',
      auth_scheme: 'none', permissions: ['network.http'], scopes: [],
      privacy: 'Only already connected, authorized Google accounts are read. The briefing remains in local TJ run history.',
      actions: [{ id: 'weekday_summary', name: 'Weekday summary', description: 'Read authorized sources and assemble a briefing', risk: 'low',
        input_schema: { type: 'object', properties: { now: { type: 'string' }, max_items: { type: 'integer' } } } }],
    }),
    test: async () => ({ ok: true, detail: 'Local briefing assembler ready; Google sources require separate connection tests' }),
    actions: {
      weekday_summary: async (_config, input) => {
        const current = new Date(input.now ?? Date.now());
        if (Number.isNaN(current.getTime())) throw new Error('Invalid summary date');
        const max = Math.max(1, Math.min(Number(input.max_items ?? 10) || 10, 30));
        const sources: Record<string, { status: 'ok' | 'not_connected' | 'error'; detail?: string }> = {};
        const calendar = await service.get('google_calendar');
        const mail = await service.get('gmail');
        const [eventsResult, mailResult] = await Promise.allSettled([
          calendar?.status === 'CONNECTED'
            ? service.execute('google_calendar', 'upcoming', { time_min: current.toISOString(), time_max: new Date(current.getTime() + 24 * 60 * 60 * 1000).toISOString(), max_results: max })
            : Promise.resolve(null),
          mail?.status === 'CONNECTED'
            ? service.execute('gmail', 'important', { max_results: max })
            : Promise.resolve(null),
        ]);
        const events = eventsResult.status === 'fulfilled' ? (eventsResult.value as any)?.events ?? [] : [];
        const messages = mailResult.status === 'fulfilled' ? (mailResult.value as any)?.messages ?? [] : [];
        sources.calendar = calendar?.status !== 'CONNECTED' ? { status: 'not_connected', detail: calendar?.missing ?? 'Connection test required' }
          : eventsResult.status === 'rejected' ? { status: 'error', detail: String(eventsResult.reason?.message ?? eventsResult.reason) } : { status: 'ok' };
        sources.email = mail?.status !== 'CONNECTED' ? { status: 'not_connected', detail: mail?.missing ?? 'Connection test required' }
          : mailResult.status === 'rejected' ? { status: 'error', detail: String(mailResult.reason?.message ?? mailResult.reason) } : { status: 'ok' };

        const tasks = db.all<{ id: string; title: string; status: string; priority: number }>(
          `SELECT id, title, status, priority FROM tasks WHERE status IN (${activeStates.map(() => '?').join(',')}) ORDER BY priority ASC, created_at DESC LIMIT ?`,
          [...activeStates, max],
        );
        sources.tasks = { status: 'ok' };
        const lines = [`TJ briefing for ${current.toISOString().slice(0, 10)}:`];
        lines.push(sources.calendar.status === 'ok'
          ? `Calendar: ${events.length ? events.map((event: any) => `${event.start ?? 'time unknown'} ${event.title}`).join('; ') : 'No events in the next 24 hours.'}`
          : `Calendar: ${sources.calendar.status === 'not_connected' ? 'not connected' : 'temporarily unavailable'}.`);
        lines.push(sources.email.status === 'ok'
          ? `Important email: ${messages.length ? messages.map((message: any) => `${message.subject} from ${message.from}`).join('; ') : 'No important messages found.'}`
          : `Important email: ${sources.email.status === 'not_connected' ? 'not connected' : 'temporarily unavailable'}.`);
        lines.push(`Active TJ tasks: ${tasks.length ? tasks.map((task) => `${task.title} (${task.status})`).join('; ') : 'None.'}`);
        return { generated_at: new Date().toISOString(), summary: lines.join('\n'), sources, events, messages, tasks,
          partial: sources.calendar.status !== 'ok' || sources.email.status !== 'ok' };
      },
    },
  };
}
