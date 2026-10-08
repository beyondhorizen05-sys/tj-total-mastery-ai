# Local API performance smoke check — 2026-10-08

Run: `pnpm --filter @tj/api exec tsx scripts/performance-smoke.ts`

Measured on Windows x64, Node v24.19.0, Intel Core i7-7600U (4 logical CPUs), 16.3 GB RAM. The script created a fresh temporary data directory, started a separate API on `127.0.0.1` with an ephemeral port, made two warmup requests and ten sequential timed requests per route, then closed the API and removed its temporary data. It did not call any external provider or AI model.

| Measure | Result |
|---|---:|
| `createServer` with fresh database | 1,025.86 ms |
| Listen on local TCP | 22.34 ms |
| Total measured startup | 1,048.19 ms |
| RSS after startup | 121.48 MB |
| RSS after requests | 135.50 MB |
| Heap used after startup | 31.51 MB |
| Heap used after requests | 36.65 MB |

| GET route | Median | P95 | Status |
|---|---:|---:|---:|
| `/api/v1/system/status` | 5.04 ms | 16.41 ms | 200 |
| `/api/v1/system/capabilities` | 10.66 ms | 24.42 ms | 200 |
| `/api/v1/connectors` | 14.95 ms | 16.67 ms | 200 |
| `/api/v1/tasks` | 15.15 ms | 16.32 ms | 200 |
| `/api/v1/workflows` | 14.27 ms | 21.60 ms | 200 |
| `/api/v1/media/items` | 14.85 ms | 17.70 ms | 200 |
| `/api/v1/wellness/entries` | 5.65 ms | 15.58 ms | 200 |
| `/api/v1/workbench/requests` | 4.40 ms | 12.81 ms | 200 |

This is a small smoke sample on an empty database. Startup excludes the time for Node to launch and import TypeScript modules, and the RSS includes the `tsx` source runtime. The results do not measure browser rendering, voice latency, large datasets, concurrent users, model calls or provider network latency. No performance target is claimed from this one run.
