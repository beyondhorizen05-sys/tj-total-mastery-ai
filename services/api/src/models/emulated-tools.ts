import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatResult, ToolSpec } from './types.js';
import { ProviderError } from './types.js';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

/** Validate generated tool data before it reaches the permission-controlled ToolRegistry. */
export function validateToolArguments(spec: ToolSpec | undefined, args: unknown): string | null {
  if (!spec) return 'Tool is not in the allowed tool registry for this agent';
  const check = (schema: any, value: unknown, depth: number): string | null => {
    if (depth > 8) return 'Argument nesting exceeds safe limit';
    if (typeof value === 'string' && value.length > 64_000) return 'Argument string is too large';
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        if (value.length > 1000) return 'Argument array is too large';
        for (const part of value) { const error = check(schema?.items ?? {}, part, depth + 1); if (error) return error; }
      } else {
        const object = value as Record<string, unknown>;
        const keys = Object.keys(object);
        if (keys.length > 100) return 'Argument object is too large';
        if (keys.some((key) => BLOCKED_KEYS.has(key))) return 'Unsafe argument key';
        const required: unknown[] = Array.isArray(schema?.required) ? schema.required : [];
        for (const key of required) if (typeof key === 'string' && !(key in object)) return 'Missing required argument: ' + key;
        for (const [key, part] of Object.entries(object)) {
          if (schema?.additionalProperties === false && !(key in (schema?.properties ?? {}))) return 'Unexpected argument: ' + key;
          const error = check(schema?.properties?.[key] ?? {}, part, depth + 1);
          if (error) return key + ': ' + error;
        }
      }
    }
    const type = schema?.type;
    if (typeof type === 'string') {
      const matches = type === 'null' ? value === null
        : type === 'array' ? Array.isArray(value)
        : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : type === 'integer' ? typeof value === 'number' && Number.isSafeInteger(value)
        : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
        : type === 'string' || type === 'boolean' ? typeof value === type : true;
      if (!matches) return 'Argument must be of type ' + type;
    }
    if (Array.isArray(schema?.enum) && !schema.enum.includes(value)) return 'Argument must match allowed enum';
    if (typeof value === 'string' && schema?.maxLength != null && value.length > schema.maxLength) return 'Argument exceeds maximum length';
    if (typeof value === 'number' && schema?.minimum != null && value < schema.minimum) return 'Argument below minimum';
    return null;
  };
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Tool arguments must be a JSON object';
  return check(spec.parameters, args, 0);
}

/** The model only proposes a request; the application validates and runs it. */
export function parseEmulatedToolReply(raw: string, tools: ToolSpec[]): { text: string; tool_calls: ChatResult['tool_calls']; finish_reason: ChatResult['finish_reason'] } {
  if (raw.length > 100_000) throw new ProviderError('Structured tool reply exceeds limit', 'bad_request', undefined, false);
  let parsed: any;
  try { parsed = JSON.parse(raw.trim()); } catch {
    throw new ProviderError('Model does not support the required structured tool format; no tools executed', 'bad_request', undefined, false);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderError('Invalid structured tool reply', 'bad_request', undefined, false);
  if (parsed.type === 'final' && typeof parsed.text === 'string') return { text: parsed.text.slice(0, 50_000), tool_calls: [], finish_reason: 'stop' };
  if (parsed.type !== 'tool_call' || typeof parsed.name !== 'string') throw new ProviderError('Expected a final answer or a tool call', 'bad_request', undefined, false);
  const error = validateToolArguments(tools.find((tool) => tool.name === parsed.name), parsed.arguments);
  if (error) throw new ProviderError('Rejected generated tool arguments: ' + error, 'bad_request', undefined, false);
  return { text: '', tool_calls: [{ id: randomUUID(), name: parsed.name, arguments: parsed.arguments }], finish_reason: 'tool_calls' };
}

/** Tool-free JSON protocol: no native tool role or untrusted generated commands are passed to provider API. */
export function emulatedToolMessages(messages: ChatMessage[], tools: ToolSpec[]): ChatMessage[] {
  const allowed = tools.map((tool) => ({ name: tool.name, description: tool.description.slice(0, 300), parameters: tool.parameters }));
  return [{
    role: 'system',
    content: 'You are using a structured, application-mediated tool protocol. Reply with ONLY one JSON object: {"type":"final","text":"answer"} or {"type":"tool_call","name":"allowed_tool_name","arguments":{}}. Do not add markdown or code fences. You cannot execute commands directly. Allowed tools: ' + JSON.stringify(allowed).slice(0, 18_000),
  }, ...messages.map((message): ChatMessage => ({
    role: message.role === 'system' ? 'system' : 'user',
    content: (message.role === 'tool' ? 'Verified tool result: ' : message.role === 'assistant' ? 'Earlier assistant response: ' : '') +
      (typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n')).slice(0, 12_000),
  }))];
}
