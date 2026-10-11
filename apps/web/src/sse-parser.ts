/** Incremental SSE framing for the authenticated desktop fetch stream.
 * No event content is synthesized, and incomplete frames are retained. */
export function readSseFrames(previous: string, chunk: string): {
  remaining: string;
  events: Array<{ type: string; data: string }>;
} {
  let remaining = previous + chunk;
  if (remaining.length > 1_000_000) throw new Error('Activity event exceeded the stream size limit');
  const events: Array<{ type: string; data: string }> = [];
  let separator: RegExpExecArray | null;
  while ((separator = /\r?\n\r?\n/.exec(remaining)) !== null) {
    const frame = remaining.slice(0, separator.index);
    remaining = remaining.slice(separator.index + separator[0].length);
    let type = 'message';
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const key = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (key === 'event' && value) type = value;
      else if (key === 'data') data.push(value);
    }
    if (data.length) events.push({ type, data: data.join('\n') });
  }
  return { remaining, events };
}
