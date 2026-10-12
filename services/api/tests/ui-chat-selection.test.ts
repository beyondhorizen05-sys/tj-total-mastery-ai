import { describe, expect, it } from 'vitest';
import {
  initialConversationId,
  canApplyConversationMessages,
  canAttachConversationReply,
} from '../../../apps/web/src/views/chat-selection.js';

describe('Chat conversation request isolation', () => {
  it('selects the first thread only when the user has not made an explicit choice', () => {
    const threads = [{ id: 'first' }, { id: 'second' }];
    expect(initialConversationId(threads, false, null)).toBe('first');
    expect(initialConversationId(threads, true, null)).toBeNull(); // Explicit New Chat.
    expect(initialConversationId(threads, false, 'second')).toBeNull();
    expect(initialConversationId([], false, null)).toBeNull();
  });

  it('rejects out-of-order conversation responses when the thread changed', () => {
    expect(canApplyConversationMessages(2, 2, 'B', 'B')).toBe(true);
    expect(canApplyConversationMessages(1, 2, 'A', 'B')).toBe(false);
    expect(canApplyConversationMessages(2, 2, 'A', 'B')).toBe(false);
    expect(canApplyConversationMessages(2, 2, 'A', null)).toBe(false); // New Chat.
  });

  it('never appends late answers to a different conversation', () => {
    expect(canAttachConversationReply('A', 'A', 'A')).toBe(true);
    expect(canAttachConversationReply('A', 'A', 'B')).toBe(false);
    expect(canAttachConversationReply('A', undefined, null)).toBe(false);
    expect(canAttachConversationReply(null, 'fresh', 'fresh')).toBe(true);
    expect(canAttachConversationReply(null, 'fresh', null)).toBe(false);
  });
});
