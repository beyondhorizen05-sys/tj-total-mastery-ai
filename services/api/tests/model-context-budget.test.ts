import { describe, expect, it } from 'vitest';
import { fitModelContext } from '../src/models/context-budget.js';
const user = (content: string) => ({ role: 'user' as const, content });
describe('Model context fitting', () => {
  it('preserves short messages', () => {
    const o = { messages: [user('hi')], max_tokens: 512 };
    expect(fitModelContext({ context_length: 8000 }, o)).toMatchObject(o);
  });
  it('preserves system instructions and latest user turn while discarding stale ones', () => {
    const result = fitModelContext({ context_length: 1024 }, { messages: [
      { role: 'system', content: 'No invented results' } as const,
      user('old ' + 'a'.repeat(3500)), user('latest request'),
    ] });
    expect(result.messages.some((m) => m.role === 'system' && m.content === 'No invented results')).toBe(true);
    expect(result.messages.some((m) => m.content === 'latest request')).toBe(true);
    expect(result.messages.some((m) => typeof m.content === 'string' && m.content.includes('old a'))).toBe(false);
  });
  it('refuses to truncate the current user request', () => {
    expect(() => fitModelContext({ context_length: 1024 }, { messages: [user('a'.repeat(8000))] })).toThrow(/context window/);
  });
  it('does not assume unknown context length', () => {
    const o = { messages: [user('hi')] };
    expect(fitModelContext({ context_length: null }, o)).toBe(o);
  });
});