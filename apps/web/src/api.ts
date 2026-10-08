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
