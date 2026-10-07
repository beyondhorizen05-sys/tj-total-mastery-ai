/** Provider-agnostic chat/completions abstraction (Spec §5). */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatContentPart {
  type: 'text' | 'image';
  text?: string;
  /** data URL or https URL */
  image_url?: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  max_tokens?: number;
  json?: boolean;
  signal?: AbortSignal;
  /** streaming callback for text deltas */
  onDelta?: (delta: string) => void;
}

export interface ChatUsage {
  tokens_in: number;
  tokens_out: number;
}

export interface ChatResult {
  text: string;
  tool_calls: ToolCall[];
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'error' | 'unknown';
  usage: ChatUsage;
  latency_ms: number;
  raw_model: string;
}

export interface DiscoveredModel {
  id: string;
  display_name?: string;
  context_length?: number | null;
  supports_tools?: boolean;
  supports_vision?: boolean;
  modalities?: Array<'text' | 'image' | 'audio' | 'video'>;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  tokens: number;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: 'auth' | 'rate_limit' | 'unavailable' | 'bad_request' | 'timeout' | 'unknown',
    public readonly status?: number,
    public readonly retryable = kind === 'rate_limit' || kind === 'unavailable' || kind === 'timeout',
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderAdapter {
  readonly kind: string;
  testConnection(): Promise<{ ok: boolean; latency_ms: number; detail: string }>;
  listModels(): Promise<DiscoveredModel[]>;
  chat(opts: ChatOptions): Promise<ChatResult>;
  embed?(texts: string[], model?: string): Promise<EmbedResult>;
  /** Default embedding model id if provider supports embeddings */
  embeddingModel?(): string | null;
}

export interface ProviderCredentials {
  api_key: string | null;
  base_url: string | null;
  organization: string | null;
}

export function classifyHttpError(status: number, body: string): ProviderError {
  const msg = body.slice(0, 400);
  if (status === 401 || status === 403) return new ProviderError(`Unauthorized (${status}): ${msg}`, 'auth', status);
  if (status === 429) return new ProviderError(`Rate limited (429): ${msg}`, 'rate_limit', status);
  if (status === 400 || status === 404 || status === 422) return new ProviderError(`Bad request (${status}): ${msg}`, 'bad_request', status);
  if (status >= 500) return new ProviderError(`Provider unavailable (${status}): ${msg}`, 'unavailable', status);
  return new ProviderError(`HTTP ${status}: ${msg}`, 'unknown', status);
}

export function wrapFetchError(e: any): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new ProviderError('Request timed out or was aborted', 'timeout');
  const code = e?.cause?.code ?? e?.code;
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'EAI_AGAIN' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new ProviderError(`Cannot reach provider (${code})`, 'unavailable');
  }
  return new ProviderError(e?.message ?? String(e), 'unknown');
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 60000, signal, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } catch (e) {
    throw wrapFetchError(e);
  } finally {
    clearTimeout(t);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Parse an SSE stream, yielding `data:` payloads. */
export async function* sseLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}
