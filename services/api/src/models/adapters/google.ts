import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatOptions, ChatResult, DiscoveredModel, EmbedResult, ProviderAdapter, ProviderCredentials, ToolCall } from '../types.js';
import { ProviderError, classifyHttpError, fetchWithTimeout, sseLines } from '../types.js';
import { estimateTokens, textOf } from './openai-format.js';

export class GoogleAdapter implements ProviderAdapter {
  readonly kind = 'google';
  constructor(private creds: ProviderCredentials) {
    if (!creds.api_key) throw new ProviderError('Google Gemini requires an API key', 'auth');
  }
  private base() { return (this.creds.base_url ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''); }
  private headers() { return { 'content-type': 'application/json', 'x-goog-api-key': this.creds.api_key! }; }

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
    const res = await fetchWithTimeout(`${this.base()}/models?pageSize=200`, { headers: this.headers(), timeoutMs: 20000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    return (json.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), display_name: m.displayName ?? m.name, context_length: m.inputTokenLimit ?? null, supports_tools: true, supports_vision: true }));
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const t = performance.now();
    const system = opts.messages.filter((m) => m.role === 'system').map(textOf).join('\n\n');
    const contents = opts.messages.filter((m) => m.role !== 'system').map(toGeminiContent);
    const body: any = { contents, generationConfig: { temperature: opts.temperature, maxOutputTokens: opts.max_tokens, responseMimeType: opts.json ? 'application/json' : undefined } };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (opts.tools?.length) body.tools = [{ functionDeclarations: opts.tools.map((tl) => ({ name: tl.name, description: tl.description, parameters: stripSchema(tl.parameters) })) }];

    const method = opts.onDelta ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const res = await fetchWithTimeout(`${this.base()}/models/${encodeURIComponent(opts.model)}:${method}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body), signal: opts.signal, timeoutMs: 180000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());

    let text = '';
    const tool_calls: ToolCall[] = [];
    let usage = { tokens_in: 0, tokens_out: 0 };
    let finish: string | undefined;
    const absorb = (json: any) => {
      const cand = json.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        if (typeof p.text === 'string') { text += p.text; opts.onDelta?.(p.text); }
        if (p.functionCall) tool_calls.push({ id: randomUUID(), name: p.functionCall.name, arguments: p.functionCall.args ?? {} });
      }
      if (cand?.finishReason) finish = cand.finishReason;
      if (json.usageMetadata) usage = { tokens_in: json.usageMetadata.promptTokenCount ?? 0, tokens_out: json.usageMetadata.candidatesTokenCount ?? 0 };
    };
    if (opts.onDelta) {
      for await (const data of sseLines(res.body!)) { try { absorb(JSON.parse(data)); } catch {} }
    } else absorb(await res.json());
    if (!usage.tokens_in) usage = { tokens_in: estimateTokens(opts.messages), tokens_out: Math.ceil(text.length / 4) };
    return { text, tool_calls, finish_reason: tool_calls.length ? 'tool_calls' : finish === 'MAX_TOKENS' ? 'length' : 'stop', usage, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
  }

  async embed(texts: string[], model = 'gemini-embedding-001'): Promise<EmbedResult> {
    const res = await fetchWithTimeout(`${this.base()}/models/${model}:batchEmbedContents`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ requests: texts.map((tx) => ({ model: `models/${model}`, content: { parts: [{ text: tx }] } })) }), timeoutMs: 60000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    return { vectors: (json.embeddings ?? []).map((e: any) => e.values), model, tokens: 0 };
  }
  embeddingModel() { return 'gemini-embedding-001'; }
}

function toGeminiContent(m: ChatMessage): any {
  if (m.role === 'tool') return { role: 'user', parts: [{ functionResponse: { name: m.name ?? 'tool', response: { result: textOf(m) } } }] };
  const role = m.role === 'assistant' ? 'model' : 'user';
  const parts: any[] = [];
  if (typeof m.content === 'string') { if (m.content) parts.push({ text: m.content }); }
  else for (const p of m.content) {
    if (p.type === 'text') parts.push({ text: p.text ?? '' });
    else {
      const mt = (p.image_url ?? '').match(/^data:(.+?);base64,(.*)$/);
      if (mt) parts.push({ inlineData: { mimeType: mt[1], data: mt[2] } });
      else parts.push({ fileData: { fileUri: p.image_url } });
    }
  }
  for (const tc of m.tool_calls ?? []) parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
  if (!parts.length) parts.push({ text: '' });
  return { role, parts };
}

/** Gemini rejects some JSON-schema keywords. */
function stripSchema(s: any): any {
  if (Array.isArray(s)) return s.map(stripSchema);
  if (s && typeof s === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(s)) if (!['additionalProperties', '$schema', 'default'].includes(k)) out[k] = stripSchema(v);
    return out;
  }
  return s;
}
