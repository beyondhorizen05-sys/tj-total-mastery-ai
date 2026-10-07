import { randomUUID } from 'node:crypto';
import type { ChatOptions, ChatResult, DiscoveredModel, EmbedResult, ProviderAdapter, ProviderCredentials, ToolCall } from '../types.js';
import { ProviderError, classifyHttpError, fetchWithTimeout, sseLines } from '../types.js';
import { toOpenAIMessage, safeJson, mapFinish, estimateTokens } from './openai-format.js';

/**
 * Adapter for OpenAI and every OpenAI-compatible endpoint
 * (xAI, DeepSeek, Mistral, Groq, Together, OpenRouter, HF, LM Studio, llama.cpp, vLLM, custom).
 */
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly kind: string;
  constructor(private creds: ProviderCredentials, kind: 'openai' | 'openai-compatible' = 'openai-compatible', private presetId: string | null = null) {
    this.kind = kind;
    if (!creds.base_url) throw new ProviderError('base_url is required', 'bad_request');
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.creds.api_key) h.authorization = `Bearer ${this.creds.api_key}`;
    if (this.creds.organization && this.kind === 'openai') h['openai-organization'] = this.creds.organization;
    if (this.presetId === 'openrouter') { h['http-referer'] = 'https://tj.local'; h['x-title'] = 'TJ Total Mastery AI'; }
    return h;
  }

  private url(p: string) { return `${this.creds.base_url!.replace(/\/+$/, '')}${p}`; }

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
    const res = await fetchWithTimeout(this.url('/models'), { headers: this.headers(), timeoutMs: 20000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    const data: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    return data.filter((m) => typeof m?.id === 'string').map((m) => ({
      id: m.id,
      display_name: m.name ?? m.id,
      context_length: m.context_length ?? m.context_window ?? m?.top_provider?.context_length ?? null,
      supports_tools: m.supported_parameters ? m.supported_parameters.includes('tools') : undefined,
      supports_vision: m.architecture?.input_modalities ? m.architecture.input_modalities.includes('image') : undefined,
    }));
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const t = performance.now();
    const body: any = { model: opts.model, messages: opts.messages.map(toOpenAIMessage), temperature: opts.temperature, max_tokens: opts.max_tokens, stream: !!opts.onDelta };
    if (opts.onDelta) body.stream_options = { include_usage: true };
    if (opts.tools?.length) body.tools = opts.tools.map((tl) => ({ type: 'function', function: { name: tl.name, description: tl.description, parameters: tl.parameters } }));
    if (opts.json) body.response_format = { type: 'json_object' };

    const res = await fetchWithTimeout(this.url('/chat/completions'), { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: opts.signal, timeoutMs: 180000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    if (!opts.onDelta) return this.parseNonStreaming(await res.json(), opts, t);
    return this.parseStreaming(res.body!, opts, t);
  }

  private parseNonStreaming(json: any, opts: ChatOptions, t: number): ChatResult {
    const choice = json.choices?.[0];
    const msg = choice?.message ?? {};
    return {
      text: msg.content ?? '',
      tool_calls: (msg.tool_calls ?? []).map((tc: any) => ({ id: tc.id ?? randomUUID(), name: tc.function?.name ?? '', arguments: safeJson(tc.function?.arguments ?? '{}') })),
      finish_reason: mapFinish(choice?.finish_reason),
      usage: { tokens_in: json.usage?.prompt_tokens ?? 0, tokens_out: json.usage?.completion_tokens ?? 0 },
      latency_ms: Math.round(performance.now() - t),
      raw_model: json.model ?? opts.model,
    };
  }

  private async parseStreaming(body: ReadableStream<Uint8Array>, opts: ChatOptions, t: number): Promise<ChatResult> {
    let text = '';
    let finish: string | undefined;
    let usage = { tokens_in: 0, tokens_out: 0 };
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    let rawModel = opts.model;
    for await (const data of sseLines(body)) {
      if (data === '[DONE]') break;
      let json: any;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.model) rawModel = json.model;
      if (json.usage) usage = { tokens_in: json.usage.prompt_tokens ?? 0, tokens_out: json.usage.completion_tokens ?? 0 };
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === 'string' && delta.content) { text += delta.content; opts.onDelta!(delta.content); }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index ?? 0;
          const acc = toolAcc.get(i) ?? { id: tc.id ?? '', name: '', args: '' };
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
          toolAcc.set(i, acc);
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    const tool_calls: ToolCall[] = [...toolAcc.values()].map((a) => ({ id: a.id || randomUUID(), name: a.name, arguments: safeJson(a.args) }));
    if (!usage.tokens_in) usage = { tokens_in: estimateTokens(opts.messages), tokens_out: Math.ceil(text.length / 4) };
    return { text, tool_calls, finish_reason: tool_calls.length ? 'tool_calls' : mapFinish(finish), usage, latency_ms: Math.round(performance.now() - t), raw_model: rawModel };
  }

  async embed(texts: string[], model?: string): Promise<EmbedResult> {
    const m = model ?? this.embeddingModel();
    if (!m) throw new ProviderError('No embedding model available for this provider', 'bad_request');
    const res = await fetchWithTimeout(this.url('/embeddings'), { method: 'POST', headers: this.headers(), body: JSON.stringify({ model: m, input: texts }), timeoutMs: 60000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    return { vectors: (json.data ?? []).map((d: any) => d.embedding), model: m, tokens: json.usage?.total_tokens ?? 0 };
  }

  embeddingModel(): string | null {
    if (this.kind === 'openai') return 'text-embedding-3-small';
    if (this.presetId === 'mistral') return 'mistral-embed';
    if (this.presetId === 'together') return 'BAAI/bge-base-en-v1.5';
    return null;
  }
}
