import type { Model } from '@tj/schemas';
import type { ChatOptions, ChatMessage } from './types.js';
import { ProviderError } from './types.js';

/** Approximate input-budget guard. This is not the provider's exact tokenization. */
export function fitModelContext(model: Pick<Model, 'context_length'>, options: Omit<ChatOptions, 'model'>): Omit<ChatOptions, 'model'> {
  const window = model.context_length;
  if (!window || window < 512) return options;
  const output = Math.max(32, Math.min(options.max_tokens ?? 1024, Math.floor(window / 4)));
  const inputLimit = window - output - Math.min(192, Math.max(32, Math.floor(window / 16)));
  const count = (messages: ChatMessage[]) => Math.ceil(JSON.stringify(messages).length / 3) + Math.ceil(JSON.stringify(options.tools ?? []).length / 3);
  if (count(options.messages) <= inputLimit) return { ...options, max_tokens: output };
  const system = options.messages.filter((m) => m.role === 'system');
  const lastUser = options.messages.findLastIndex((m) => m.role === 'user');
  if (lastUser < 0) throw new ProviderError('No user turn to preserve when compacting model context', 'bad_request', undefined, false);
  const latest = options.messages.slice(lastUser).filter((m) => m.role !== 'system');
  let selected = [...system, ...latest];
  if (count(selected) > inputLimit) throw new ProviderError('Latest request exceeds the selected model context window; shorten the input or select a larger model', 'bad_request', undefined, false);
  const earlier = options.messages.slice(0, lastUser).filter((m) => m.role !== 'system');
  const turns: ChatMessage[][] = [];
  for (const message of earlier) {
    if (message.role === 'user' || !turns.length) turns.push([message]);
    else turns.at(-1)!.push(message);
  }
  let omitted = turns.length;
  for (let i = turns.length - 1; i >= 0; i--) {
    const candidate = [...system, ...turns.slice(i).flat(), ...latest];
    if (count(candidate) > inputLimit - 85) break;
    selected = candidate; omitted = i;
  }
  if (omitted > 0) {
    const note: ChatMessage = { role: 'system', content: '[' + omitted + ' older conversation turns omitted to fit context; no summary invented. Ask for missing details.]' };
    if (count([note, ...selected]) <= inputLimit) selected = [note, ...selected];
  }
  return { ...options, max_tokens: output, messages: selected };
}
