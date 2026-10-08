import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadConfig } from '../src/config.js';
import { createServer } from '../src/server/app.js';

const samples = 10;
const routes = [
  '/api/v1/system/status',
  '/api/v1/system/capabilities',
  '/api/v1/connectors',
  '/api/v1/tasks',
  '/api/v1/workflows',
  '/api/v1/media/items',
  '/api/v1/wellness/entries',
  '/api/v1/workbench/requests',
];

function rounded(value: number) { return Math.round(value * 100) / 100; }
function megabytes(value: number) { return rounded(value / 1024 / 1024); }
function percentile(values: number[], p: number) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil((ordered.length * p) / 100) - 1)];
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-performance-'));
let server: Awaited<ReturnType<typeof createServer>> | null = null;
try {
  const config = loadConfig({ dataDir: tempDir, host: '127.0.0.1', port: 0, enableTestProvider: false });
  const start = performance.now();
  server = await createServer(config);
  const constructed = performance.now();
  const base = await server.app.listen({ host: '127.0.0.1', port: 0 });
  const listening = performance.now();
  const afterStart = process.memoryUsage();
  const results: Record<string, unknown>[] = [];
  for (const route of routes) {
    const timings: number[] = [];
    const statuses: number[] = [];
    for (let index = 0; index < samples + 2; index++) {
      const before = performance.now();
      const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(5_000), cache: 'no-store' });
      await response.arrayBuffer();
      if (index >= 2) { timings.push(performance.now() - before); statuses.push(response.status); }
    }
    results.push({ route, status: [...new Set(statuses)], median_ms: rounded(percentile(timings, 50)),
      p95_ms: rounded(percentile(timings, 95)), max_ms: rounded(Math.max(...timings)) });
  }
  const afterRoutes = process.memoryUsage();
  const report = {
    measured_at: new Date().toISOString(), environment: { node: process.version, platform: process.platform,
      architecture: process.arch, cpu: os.cpus()[0]?.model ?? 'unknown', logical_cpus: os.cpus().length,
      total_ram_mb: megabytes(os.totalmem()) },
    method: `Fresh temporary data directory; local TCP 127.0.0.1; 2 warmup + ${samples} sequential samples per route; no model/provider calls`,
    startup: { create_server_ms: rounded(constructed - start), listen_ms: rounded(listening - constructed),
      total_ms: rounded(listening - start) },
    memory_mb: { after_start: { rss: megabytes(afterStart.rss), heap_used: megabytes(afterStart.heapUsed) },
      after_routes: { rss: megabytes(afterRoutes.rss), heap_used: megabytes(afterRoutes.heapUsed) } },
    routes: results,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (results.some((entry) => !Array.isArray(entry.status) || !entry.status.every((status) => status === 200))) process.exitCode = 1;
} finally {
  if (server) {
    server.scheduler.stop();
    await server.app.close();
    server.db.close();
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}
