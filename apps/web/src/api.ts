export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : endpoint;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    let errText = res.statusText;
    try {
      const json = await res.json();
      if (json.error) errText = json.error;
    } catch {
      errText = await res.text();
    }
    throw new Error(errText || `Request failed with status ${res.status}`);
  }

  return res.json();
}
