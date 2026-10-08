import type { ChatGPTPlanService } from '../chatgpt-plan.js';
import type { ChatOptions, ChatResult, DiscoveredModel, ProviderAdapter } from '../types.js';
import { ProviderError, sseLines } from '../types.js';

/** The documented ChatGPT-plan route is streamed Responses API, not Chat Completions. */
export class ChatGPTPlanAdapter implements ProviderAdapter {
  readonly kind = 'chatgpt-plan';
  constructor(private service: ChatGPTPlanService, private accountId: string) {}

  async listModels(): Promise<DiscoveredModel[]> {
    return (await this.service.listModels(this.accountId)).map((m) => ({
      id: m.id, display_name: m.display_name, supports_tools: false, supports_vision: false,
    }));
  }

  async testConnection() {
    const start = performance.now();
    try {
      const models = await this.listModels();
      return { ok: true, latency_ms: Math.round(performance.now() - start), detail: `${models.length} eligible model(s) discovered` };
    } catch (error) {
      return { ok: false, latency_ms: Math.round(performance.now() - start), detail: error instanceof Error ? error.message : 'ChatGPT connection unavailable' };
    }
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    if (opts.tools?.length) throw new ProviderError('This ChatGPT plan connection does not support TJ agent tool calls yet.', 'bad_request', undefined, false);
    const instructions: string[] = [];
    const input: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const message of opts.messages) {
      if (message.tool_calls?.length || message.role === 'tool') throw new ProviderError('Tool-call history is unsupported for this connection.', 'bad_request', undefined, false);
      if (typeof message.content !== 'string') throw new ProviderError('This connection currently supports text messages only.', 'bad_request', undefined, false);
      if (message.role === 'system') instructions.push(message.content);
      else input.push({ role: message.role, content: message.content });
    }
    if (!input.length) throw new ProviderError('A user or assistant message is required.', 'bad_request', undefined, false);
    const token = await this.service.accessToken(this.accountId);
    const started = performance.now();
    const body: Record<string, unknown> = { model: opts.model, input, store: false, stream: true };
    if (instructions.length) body.instructions = instructions.join('\n\n');
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body), signal: opts.signal ?? AbortSignal.timeout(180_000),
      });
    } catch (error) {
      throw new ProviderError(error instanceof Error ? error.message : 'ChatGPT request failed', 'unavailable', undefined, false);
    }
    if (!response.ok) {
      let code = '';
      try { const data = await response.json() as { error?: { code?: string } }; code = data.error?.code ?? ''; } catch { /* response shape may vary */ }
      const kind = response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate_limit' : 'unavailable';
      throw new ProviderError(code ? `ChatGPT plan request failed: ${code}` : `ChatGPT plan request failed (${response.status})`, kind, response.status, false);
    }
    if (!response.body) throw new ProviderError('ChatGPT response stream was empty.', 'unavailable', undefined, false);
    let text = '';
    let completed = false;
    let usage = { tokens_in: 0, tokens_out: 0 };
    for await (const line of sseLines(response.body)) {
      if (line === '[DONE]') break;
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        text += event.delta;
        opts.onDelta?.(event.delta);
      } else if (event.type === 'response.failed') {
        throw new ProviderError(`ChatGPT response failed: ${event.response?.error?.code ?? 'unknown_error'}`, 'unavailable', undefined, false);
      } else if (event.type === 'response.incomplete') {
        throw new ProviderError('ChatGPT response was incomplete.', 'unavailable', undefined, false);
      } else if (event.type === 'response.completed') {
        completed = true;
        usage = { tokens_in: event.response?.usage?.input_tokens ?? 0, tokens_out: event.response?.usage?.output_tokens ?? 0 };
        if (!text) text = (event.response?.output ?? []).flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text ?? '').join('');
      }
    }
    if (!completed) throw new ProviderError('ChatGPT stream ended without response.completed.', 'unavailable', undefined, false);
    return { text, tool_calls: [], finish_reason: 'stop', usage, latency_ms: Math.round(performance.now() - started), raw_model: opts.model };
  }
}
