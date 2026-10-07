import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatOptions, ChatResult, DiscoveredModel, ProviderAdapter, ProviderCredentials, ToolCall } from '../types.js';
import { ProviderError, classifyHttpError, fetchWithTimeout, sseLines } from '../types.js';
import { estimateTokens, safeJson, textOf } from './openai-format.js';

const VERSION = '2023-06-01';

export class AnthropicAdapter implements ProviderAdapter {
  readonly kind = 'anthropic';
  constructor(private creds: ProviderCredentials) {
    if (!creds.api_key) throw new ProviderError('Anthropic requires an API key', 'auth');
  }
  private base() { return (this.creds.base_url ?? 'https://api.anthropic.com').replace(/\/+$/, ''); }
  private headers() {
    return { 'content-type': 'application/json', 'x-api-key': this.creds.api_key!, 'anthropic-version': VERSION };
  }

  async testConnection() {
    const t = performance.now();
    try {
      const models = await this.listModels();
      return { ok: true, latency_ms: Math.round(performance.now() - t), detail: `${models.length} model(s) discovered` };
    } catch (e: any) {
      return { ok: false, latency_ms: Math.round(performance.now() - t), detail: e.message };
    }
  }

  async listModels(): Promise<DiscoveredModel[]> {
    const res = await fetchWithTimeout(`${this.base()}/v1/models?limit=100`, { headers: this.headers(), timeoutMs: 20000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    return (json.data ?? []).map((m: any) => ({ id: m.id, display_name: m.display_name ?? m.id, context_length: 200000, supports_tools: true, supports_vision: true }));
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const t = performance.now();
    const system = opts.messages.filter((m) => m.role === 'system').map(textOf).join('\n\n');
    const messages = opts.messages.filter((m) => m.role !== 'system').map(toAnthropicMessage);
    const body: any = { model: opts.model, max_tokens: opts.max_tokens ?? 4096, messages, stream: !!opts.onDelta };
    if (system) body.system = system;
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.tools?.length) body.tools = opts.tools.map((tl) => ({ name: tl.name, description: tl.description, input_schema: tl.parameters }));

    const res = await fetchWithTimeout(`${this.base()}/v1/messages`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: opts.signal, timeoutMs: 180000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());

    if (!opts.onDelta) {
      const json: any = await res.json();
      const text = (json.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
      const tool_calls: ToolCall[] = (json.content ?? []).filter((c: any) => c.type === 'tool_use').map((c: any) => ({ id: c.id, name: c.name, arguments: c.input ?? {} }));
      return { text, tool_calls, finish_reason: tool_calls.length ? 'tool_calls' : json.stop_reason === 'max_tokens' ? 'length' : 'stop', usage: { tokens_in: json.usage?.input_tokens ?? 0, tokens_out: json.usage?.output_tokens ?? 0 }, latency_ms: Math.round(performance.now() - t), raw_model: json.model ?? opts.model };
    }

    let text = '';
    const blocks = new Map<number, { id: string; name: string; json: string }>();
    let usage = { tokens_in: 0, tokens_out: 0 };
    let stop: string | undefined;
    for await (const data of sseLines(res.body!)) {
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === 'message_start') usage.tokens_in = ev.message?.usage?.input_tokens ?? 0;
      else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
      else if (ev.type === 'content_block_delta') {
        if (ev.delta?.type === 'text_delta' && ev.delta.text) { text += ev.delta.text; opts.onDelta(ev.delta.text); }
        else if (ev.delta?.type === 'input_json_delta') { const b = blocks.get(ev.index); if (b) b.json += ev.delta.partial_json ?? ''; }
      } else if (ev.type === 'message_delta') { usage.tokens_out = ev.usage?.output_tokens ?? usage.tokens_out; stop = ev.delta?.stop_reason; }
    }
    const tool_calls: ToolCall[] = [...blocks.values()].map((b) => ({ id: b.id || randomUUID(), name: b.name, arguments: safeJson(b.json) }));
    if (!usage.tokens_in) usage = { tokens_in: estimateTokens(opts.messages), tokens_out: Math.ceil(text.length / 4) };
    return { text, tool_calls, finish_reason: tool_calls.length ? 'tool_calls' : stop === 'max_tokens' ? 'length' : 'stop', usage, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
  }
}

function toAnthropicMessage(m: ChatMessage): any {
  if (m.role === 'tool') {
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: textOf(m) }] };
  }
  if (m.role === 'assistant' && m.tool_calls?.length) {
    const content: any[] = [];
    const txt = textOf(m);
    if (txt) content.push({ type: 'text', text: txt });
    for (const tc of m.tool_calls) content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
    return { role: 'assistant', content };
  }
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: m.content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text ?? '' };
      const url = p.image_url ?? '';
      const mt = url.match(/^data:(.+?);base64,(.*)$/);
      return mt ? { type: 'image', source: { type: 'base64', media_type: mt[1], data: mt[2] } } : { type: 'image', source: { type: 'url', url } };
    }),
  };
}
