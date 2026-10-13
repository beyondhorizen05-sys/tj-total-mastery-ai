import { Capacitor } from '@capacitor/core';

export const STORAGE_KEY_API_BASE = 'tj_api_base_url';

export const isNativePlatform = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

export const isDesktopApp = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    window.location.hostname === 'tauri.localhost' ||
    window.location.protocol === 'tauri:' ||
    '__TAURI_INTERNALS__' in window ||
    '__TAURI__' in window ||
    navigator.userAgent.includes('Tauri')
  );
};

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  const stored = localStorage.getItem(STORAGE_KEY_API_BASE)?.trim().replace(/\/+$/, '');
  if (stored) {
    if (!stored.includes('tauri.localhost') && !stored.startsWith('tauri:') && !stored.includes(':5173')) {
      return stored;
    }
    localStorage.removeItem(STORAGE_KEY_API_BASE);
  }

  // In native mobile app, default to PC LAN Wi-Fi host
  if (isNativePlatform()) {
    return 'http://192.168.13.167:4780';
  }

  // In desktop Tauri app or when served on any port other than 4780, default to local API backend
  if (isDesktopApp() || window.location.port !== '4780' || window.location.protocol.startsWith('tauri')) {
    return 'http://127.0.0.1:4780';
  }

  return '';
}

export function setApiBaseUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const clean = url.trim().replace(/\/+$/, '');
  if (!clean) {
    localStorage.removeItem(STORAGE_KEY_API_BASE);
  } else {
    localStorage.setItem(STORAGE_KEY_API_BASE, clean);
  }
}

export function apiUrl(endpoint: string): string {
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    return endpoint;
  }
  const base = getApiBaseUrl();
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return base ? `${base}${path}` : path;
}

// Automatically resolve relative EventSource URLs to the configured API server host
if (typeof window !== 'undefined' && window.EventSource) {
  const NativeEventSource = window.EventSource;
  // Override EventSource for dynamic API host routing
  (window as any).EventSource = class extends NativeEventSource {
    constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
      const resolved = typeof url === 'string' ? apiUrl(url) : url;
      super(resolved, eventSourceInitDict);
    }
  };
}

export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const primaryUrl = apiUrl(endpoint);
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let res: Response;
  try {
    res = await fetch(primaryUrl, {
      ...options,
      headers,
    });
  } catch (primaryErr) {
    // If the primary URL failed and was not already pointing at 127.0.0.1:4780, retry explicitly on local backend
    if (!primaryUrl.startsWith('http://127.0.0.1:4780')) {
      const fallbackUrl = `http://127.0.0.1:4780${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
      try {
        res = await fetch(fallbackUrl, {
          ...options,
          headers,
        });
      } catch {
        throw primaryErr;
      }
    } else {
      throw primaryErr;
    }
  }

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

  return res.status === 204 ? (undefined as T) : res.json();
}

export async function apiChatStream<T = any>(body: Record<string, unknown>, onDelta: (delta: string) => void): Promise<T> {
  const response = await fetch(apiUrl('/api/v1/chat'), {
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
