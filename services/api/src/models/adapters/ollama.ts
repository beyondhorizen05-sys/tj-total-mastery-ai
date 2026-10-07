import { randomUUID } from 'node:crypto';
import type { ChatOptions, ChatResult, DiscoveredModel, EmbedResult, ProviderAdapter, ProviderCredentials, ToolCall } from '../types.js';
import { classifyHttpError, fetchWithTimeout } from '../types.js';
import { toOpenAIMessage, estimateTokens } from './openai-format.js';

/** Ollama native API (richer model metadata than its OpenAI-compat shim). */
export class OllamaAdapter implements ProviderAdapter {
  readonly kind = 'ollama';
  constructor(private creds: ProviderCredentials) {}
  private base() { return (this.creds.base_url ?? 'http://127.0.0.1:11434').replace(/\/+$/, ''); }

  async testConnection() {
    const t = performance.now();
    try {
      const res = await fetchWithTimeout(`${this.base()}/api/version`, { timeoutMs: 5000 });
      if (!res.ok) throw classifyHttpError(res.status, await res.text());
      const v: any = await res.json();
      const models = await this.listModels();
      return { ok: true, latency_ms: Math.round(performance.now() - t), detail: `Ollama ${v.version}, ${models.length} model(s) pulled${models.length ? '' : ' — run `ollama pull llama3.2`'}` };
    } catch (e: any) {
      return { ok: false, latency_ms: Math.round(performance.now() - t), detail: `${e.message}. Is Ollama installed and running? (https://ollama.com/download)` };
    }
  }

  async listModels(): Promise<DiscoveredModel[]> {
    const res = await fetchWithTimeout(`${this.base()}/api/tags`, { timeoutMs: 8000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    return (json.models ?? []).map((m: any) => ({
      id: m.name,
      display_name: m.name,
      context_length: null,
      supports_vision: /llava|vision|moondream|bakllava|minicpm-v|gemma3|qwen.*vl/i.test(m.name),
      supports_tools: /llama3\.[1-3]|qwen|mistral|command-r|hermes|firefunction|gemma3|phi4|deepseek/i.test(m.name),
    }));
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    const t = performance.now();
    const body: any = { model: opts.model, messages: opts.messages.map(toOllamaMessage), stream: !!opts.onDelta, options: { temperature: opts.temperature, num_predict: opts.max_tokens } };
    if (opts.tools?.length) body.tools = opts.tools.map((tl) => ({ type: 'function', function: { name: tl.name, description: tl.description, parameters: tl.parameters } }));
    if (opts.json) body.format = 'json';
    const res = await fetchWithTimeout(`${this.base()}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: opts.signal, timeoutMs: 600000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());

    let text = '';
    const tool_calls: ToolCall[] = [];
    let usage = { tokens_in: 0, tokens_out: 0 };
    let done_reason: string | undefined;
    const absorb = (json: any) => {
      const c = json.message?.content;
      if (typeof c === 'string' && c) { text += c; opts.onDelta?.(c); }
      for (const tc of json.message?.tool_calls ?? []) tool_calls.push({ id: randomUUID(), name: tc.function?.name, arguments: tc.function?.arguments ?? {} });
      if (json.done) { usage = { tokens_in: json.prompt_eval_count ?? 0, tokens_out: json.eval_count ?? 0 }; done_reason = json.done_reason; }
    };
    if (opts.onDelta) {
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line) { try { absorb(JSON.parse(line)); } catch {} }
        }
      }
      if (buf.trim()) { try { absorb(JSON.parse(buf)); } catch {} }
    } else absorb(await res.json());
    if (!usage.tokens_in) usage = { tokens_in: estimateTokens(opts.messages), tokens_out: Math.ceil(text.length / 4) };
    return { text, tool_calls, finish_reason: tool_calls.length ? 'tool_calls' : done_reason === 'length' ? 'length' : 'stop', usage, latency_ms: Math.round(performance.now() - t), raw_model: opts.model };
  }

  async embed(texts: string[], model = 'nomic-embed-text'): Promise<EmbedResult> {
    const res = await fetchWithTimeout(`${this.base()}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts }), timeoutMs: 120000 });
    if (!res.ok) throw classifyHttpError(res.status, await res.text());
    const json: any = await res.json();
    return { vectors: json.embeddings ?? [], model, tokens: json.prompt_eval_count ?? 0 };
  }
  embeddingModel() { return 'nomic-embed-text'; }
}

function toOllamaMessage(m: any): any {
  const o = toOpenAIMessage(m);
  if (Array.isArray(o.content)) {
    const images = o.content.filter((p: any) => p.type === 'image_url').map((p: any) => String(p.image_url.url).replace(/^data:.*?;base64,/, ''));
    o.content = o.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n');
    if (images.length) o.images = images;
  }
  return o;
}
