import type { Connector } from '@tj/schemas';

/** Connector SDK (Spec §38). A connector = manifest + health test + action handlers. */
export type ConnectorManifest = Omit<Connector, 'status' | 'health' | 'last_error' | 'last_checked_at' | 'configured_keys' | 'missing'>;

export interface ConnectorRuntime {
  manifest: ConnectorManifest;
  /** Verify credentials/connectivity against the real service. */
  test(cfg: Record<string, string>): Promise<{ ok: boolean; detail: string; latency_ms?: number }>;
  actions: Record<string, (cfg: Record<string, string>, input: Record<string, any>) => Promise<unknown>>;
}

export async function httpJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<any> {
  const { timeoutMs = 20000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const field = (key: string, label: string, secret: boolean, required = true, help?: string, placeholder?: string) => ({ key, label, secret, required, help, placeholder });

export function manifest(m: Partial<ConnectorManifest> & Pick<ConnectorManifest, 'id' | 'name' | 'provider' | 'description' | 'category'>): ConnectorManifest {
  return {
    icon: '🔌', auth_scheme: 'api_key', scopes: [], permissions: ['connector.use'], actions: [], triggers: [], privacy: 'Requests are sent directly from this device to the provider.',
    config_fields: [], docs_url: null, version: '1.0.0', rate_limit: null, ...m,
  };
}
