type LocalDesktopConnection = { base_url: string; token: string };
let desktopConnection: Promise<LocalDesktopConnection> | undefined;

async function connection(): Promise<LocalDesktopConnection> {
  const internals = (globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<LocalDesktopConnection> };
  }).__TAURI_INTERNALS__;
  if (!internals?.invoke) return { base_url: '', token: '' };
  if (!desktopConnection) {
    desktopConnection = (async () => {
      for (let attempt = 0; attempt < 40; attempt++) {
        try { return await internals.invoke('desktop_api_connection'); }
        catch (error) {
          if (attempt === 39) throw error;
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
      throw new Error('Desktop API did not initialize');
    })().catch((error) => {
      desktopConnection = undefined;
      throw error;
    });
  }
  return desktopConnection;
}

/** Browser development uses the Vite /api proxy; packaged Tauri uses an authenticated local API. */
export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const backend = await connection();
  const url = backend.base_url && endpoint.startsWith('/api/')
    ? backend.base_url + endpoint : endpoint;
  const headers = new Headers(options.headers);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (backend.token && endpoint.startsWith('/api/')) headers.set('X-TJ-Desktop-Token', backend.token);
  let res: Response | undefined;
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      res = await fetch(url, { ...options, headers });
      break;
    } catch (error) {
      if (!backend.base_url || attempt === 7 || options.signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!res) throw new Error('Local TJ API did not respond');
  if (!res.ok) {
    const body = await res.text();
    let errText = body || res.statusText;
    try {
      const json = JSON.parse(body);
      if (typeof json.error === 'string') errText = json.error;
      else if (typeof json.message === 'string') errText = json.message;
    } catch { /* use the response text */ }
    throw new Error(errText || 'Request failed with status ' + res.status);
  }
  return res.status === 204 ? undefined as T : res.json();
}
