import { describe, expect, it } from 'vitest';
import { readSseFrames } from '../../../apps/web/src/sse-parser.js';

describe('Authenticated desktop SSE framing', () => {
  it('preserves named events across fragmented network chunks', () => {
    const first = readSseFrames('', 'event: approval.requested\ndata: {"id":');
    expect(first.events).toEqual([]);
    const second = readSseFrames(first.remaining, '"a"}\n\nevent: task.completed\ndata: {"id":"b"}\n\n');
    expect(second).toEqual({ remaining: '', events: [
      { type: 'approval.requested', data: '{"id":"a"}' },
      { type: 'task.completed', data: '{"id":"b"}' },
    ] });
  });

  it('supports CRLF, multiline data and ignores comments without inventing events', () => {
    const result = readSseFrames('', ': heartbeat\r\n\r\nevent: workflow.failed\r\ndata: line one\r\ndata: line two\r\n\r\n');
    expect(result.events).toEqual([{ type: 'workflow.failed', data: 'line one\nline two' }]);
  });

  it('rejects unbounded incomplete event frames', () => {
    expect(() => readSseFrames('data: ', 'x'.repeat(1_000_001))).toThrow(/size limit/);
  });
});
