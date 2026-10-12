/**
 * Read-only source-runtime acceptance baseline.
 *
 * Against an already-running source checkout:
 *   node scripts/source-runtime-smoke.mjs
 *
 * To run against a temporary isolated build (used in CI):
 *   pnpm run build && node scripts/source-runtime-smoke.mjs --isolated
 *
 * No credentials, personal data, response bodies, or model prompts are printed.
 * A missing model is NEEDS_SETUP, not a fake pass or a source-server failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isolated = process.argv.includes('--isolated');
let backend;
let tmpDir;
let stderr = '';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

let base = process.env.TJ_LOCAL_API_URL || 'http://127.0.0.1:4780';
const checks = [
  ['/api/v1/system/status', (r) => typeof r.version === 'string' &&
    Array.isArray(r.components) && r.components.some((x) => x.component === 'database' && x.state === 'healthy')],
  ['/api/v1/system/first-run', (r) => typeof r.first_run_completed === 'boolean'],
  ['/api/v1/settings', (r) => r.settings && typeof r.settings === 'object'],
  ['/api/v1/models/providers', (r) => Array.isArray(r.providers)],
  ['/api/v1/models', (r) => Array.isArray(r.models)],
  ['/api/v1/models/candidates?task_type=chat', (r) => Array.isArray(r.candidates)],
  ['/api/v1/agents', (r) => Array.isArray(r.agents)],
  ['/api/v1/agents/templates', (r) => Array.isArray(r.templates)],
  ['/api/v1/town/state', (r) => Array.isArray(r.agents)],
  ['/api/v1/workflows', (r) => Array.isArray(r.workflows)],
  ['/api/v1/workflow-runs', (r) => Array.isArray(r.runs)],
  ['/api/v1/system/activity?limit=1', (r) => Array.isArray(r.events)],
];

async function request(endpoint, timeout = 5000) {
  const response = await fetch(new URL(endpoint, base), { signal: AbortSignal.timeout(timeout), cache: 'no-store' });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

try {
  if (isolated) {
    const api = path.join(root, 'services', 'api', 'dist', 'main.js');
    if (!fs.existsSync(api)) throw new Error('Run pnpm run build before --isolated');
    const port = await freePort();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-source-runtime-smoke-'));
    base = 'http://127.0.0.1:' + port;
    backend = spawn(process.execPath, [api], {
      cwd: path.dirname(api),
      env: {
        ...process.env,
        TJ_HOST: '127.0.0.1',
        TJ_PORT: String(port),
        TJ_DATA_DIR: tmpDir,
        TJ_ENABLE_TEST_PROVIDER: '0',
        TJ_CHATGPT_PLAN_SIGNIN_ENABLED: '0',
        TJ_DESKTOP_TOKEN: '',
        TJ_DESKTOP_TOKEN_FILE: '',
      },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    backend.stderr?.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-2000); });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (backend.exitCode !== null) throw new Error('Isolated API exited unexpectedly (' + backend.exitCode + ')');
      try { await request('/api/v1/system/status', 1000); ready = true; break; }
      catch { await sleep(250); }
    }
    if (!ready) throw new Error('Isolated API did not start: ' + stderr.slice(-350));
  } else {
    // A caller cannot accidentally transmit a local acceptance check to a cloud URL.
    const target = new URL(base);
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
        target.username || target.password || target.search || target.hash || target.pathname !== '/') {
      throw new Error('TJ_LOCAL_API_URL must be a plain loopback HTTP origin');
    }
  }

  let failed = 0;
  let modelCount = 0;
  let providerCount = 0;
  for (const [endpoint, valid] of checks) {
    try {
      const response = await request(endpoint);
      if (!valid(response)) throw new Error('unexpected response shape or unhealthy database');
      if (endpoint === '/api/v1/models') modelCount = response.models.filter((m) => m.available === true).length;
      if (endpoint === '/api/v1/models/providers') providerCount = response.providers.length;
      console.log('PASS ' + endpoint);
    } catch (e) {
      failed++;
      // Deliberately print no response bodies or app data.
      console.error('FAIL ' + endpoint + ': ' + (e instanceof Error ? e.message : 'request failed'));
    }
  }

  const controller = new AbortController();
  try {
    const response = await fetch(new URL('/api/v1/system/events', base), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      headers: { Accept: 'text/event-stream' },
    });
    if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/event-stream')) {
      throw new Error('event stream did not return SSE');
    }
    console.log('PASS /api/v1/system/events (SSE headers)');
  } catch (e) {
    failed++;
    console.error('FAIL /api/v1/system/events: ' + (e instanceof Error ? e.message : 'request failed'));
  } finally {
    controller.abort();
  }
  console.log('MODEL ' + (modelCount > 0 ? 'CANDIDATES_PRESENT' : 'NEEDS_SETUP') +
    ' (providers: ' + providerCount + ', available models: ' + modelCount + ')');
  console.log('RESULT ' + (failed === 0 ? 'READ_ONLY_SOURCE_API_SMOKE_PASS' : 'SOURCE_API_SMOKE_FAILED') +
    ' (' + (checks.length + 1 - failed) + '/' + (checks.length + 1) + ' endpoints)');
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error('FAIL source-runtime-smoke: ' + (error instanceof Error ? error.message : 'unknown failure'));
  process.exitCode = 1;
} finally {
  if (backend) {
    backend.kill();
    await new Promise((resolve) => {
      if (backend.exitCode !== null || backend.signalCode !== null) return resolve();
      backend.once('exit', resolve);
      setTimeout(resolve, 3000).unref();
    });
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
}
