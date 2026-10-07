import type { ChatMessage, ChatResult } from '../types.js';

export function toOpenAIMessage(m: ChatMessage): any {
  const out: any = { role: m.role };
  if (typeof m.content === 'string') out.content = m.content;
  else out.content = m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text ?? '' } : { type: 'image_url', image_url: { url: p.image_url } }));
  if (m.name) out.name = m.name;
  if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
  if (m.tool_calls?.length) out.tool_calls = m.tool_calls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.arguments) } }));
  return out;
}

export function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}');
    return typeof v === 'object' && v ? v : {};
  } catch {
    return { _raw: s };
  }
}

export function mapFinish(r?: string): ChatResult['finish_reason'] {
  if (r === 'stop' || r === 'end_turn' || r === 'STOP') return 'stop';
  if (r === 'tool_calls' || r === 'function_call' || r === 'tool_use') return 'tool_calls';
  if (r === 'length' || r === 'max_tokens' || r === 'MAX_TOKENS') return 'length';
  return r ? 'unknown' : 'stop';
}

export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += typeof m.content === 'string' ? m.content.length : m.content.reduce((a, p) => a + (p.text?.length ?? 0), 0);
  return Math.ceil(chars / 4);
}

export function textOf(m: ChatMessage): string {
  return typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join('\n');
}
