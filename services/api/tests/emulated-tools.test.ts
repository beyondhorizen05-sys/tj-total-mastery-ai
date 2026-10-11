import { describe, expect, it } from 'vitest';
import { emulatedToolMessages, parseEmulatedToolReply, validateToolArguments } from '../src/models/emulated-tools.js';

const tools = [{ name: 'fs_read', description: 'Read a file', parameters: {
  type: 'object', properties: { path: { type: 'string', maxLength: 200 } }, required: ['path'], additionalProperties: false,
} }];
describe('Model-independent tool protocol', () => {
  it('accepts one allowlisted valid request', () => {
    const r = parseEmulatedToolReply('{"type":"tool_call","name":"fs_read","arguments":{"path":"notes.txt"}}', tools);
    expect(r.tool_calls[0]?.name).toBe('fs_read');
    expect(r.finish_reason).toBe('tool_calls');
  });
  it('rejects unknown tools and never emits an executable request', () => {
    expect(() => parseEmulatedToolReply('{"type":"tool_call","name":"shell_exec","arguments":{}}', tools)).toThrow(/Rejected/);
  });
  it('rejects invalid arguments for both native and emulated calls', () => {
    expect(validateToolArguments(tools[0], {})).toMatch(/Missing required/);
    expect(validateToolArguments(tools[0], { path: 42 })).toMatch(/string/);
    expect(validateToolArguments(tools[0], { path: 'x', surprise: true })).toMatch(/Unexpected/);
  });
  it('rejects malicious prototype keys', () => {
    expect(validateToolArguments(tools[0], JSON.parse('{"path":"x","__proto__":{"polluted":true}}'))).toMatch(/Unsafe/);
  });
  it('rejects markdown or unstructured tool requests', () => {
    expect(() => parseEmulatedToolReply('run fs_read("notes.txt")', tools)).toThrow(/structured/);
  });
  it('allows a strictly formatted final response without executing a tool', () => {
    expect(parseEmulatedToolReply('{"type":"final","text":"Done"}', tools)).toMatchObject({ text: 'Done', tool_calls: [] });
  });
  it('converts previous tool results into provider-neutral text', () => {
    const messages = emulatedToolMessages([{ role: 'tool', tool_call_id: 'c1', name: 'fs_read', content: 'saved results' }], tools);
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toContain('Verified tool result');
  });
});