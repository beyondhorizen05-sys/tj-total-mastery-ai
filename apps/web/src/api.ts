export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : endpoint;
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text();
    let errText = body || res.statusText;
    try {
      const json = JSON.parse(body);
      if (typeof json.error === 'string') errText = json.error;
      else if (typeof json.message === 'string') errText = json.message;
    } catch { /* use the response text */ }
    throw new Error(errText || `Request failed with status ${res.status}`);
  }

  return res.status === 204 ? undefined as T : res.json();
}

export async function apiChatStream<T = any>(body: Record<string, unknown>, onDelta: (delta: string) => void): Promise<T> {
  const response = await fetch('/api/v1/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text || response.statusText;
    try {
      const payload = JSON.parse(text) as { error?: string; message?: string };
      message = payload.error ?? payload.message ?? message;
    } catch { /* use the response text */ }
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json() as Promise<T>;
  if (!response.body) throw new Error('Chat response stream was empty');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let result: T | undefined;
  let streamError: string | undefined;
  const consumeFrame = (frame: string) => {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7);
    const data = lines.filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
    if (!event || !data) return;
    const payload = JSON.parse(data) as { delta?: string; error?: string } & T;
    if (event === 'delta' && typeof payload.delta === 'string') onDelta(payload.delta);
    else if (event === 'done') result = payload;
    else if (event === 'error') streamError = payload.error ?? 'Chat request failed';
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let boundary = buffered.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffered.slice(0, boundary);
        const separator = buffered.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
        buffered = buffered.slice(boundary + separator.length);
        consumeFrame(frame);
        boundary = buffered.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (streamError) throw new Error(streamError);
  if (result === undefined) throw new Error('Chat stream ended before completion');
  return result;
}
