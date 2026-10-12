# Mission 001 Test Results

Results below are from the current local checkout on 2026-10-11. A pass applies only to the named check; it does not certify the full master prompt.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm run test` | Passed | 47 API test files, 274 tests passed; schemas package has no tests and passes `--passWithNoTests`. |
| `pnpm run test:e2e` | Passed | 2 files, 6 tests passed, including §84 delivery with explicitly approved mocked web search and temp-root project isolation. |
| `pnpm --filter @tj/api exec vitest run tests/router-fallback.test.ts` | Passed | 9 tests; 20 chat calls reused explicit exact-model durable consent, while `approve_once` triggered a new approval on the next call. |
| `pnpm --filter @tj/api exec vitest run tests/health-monitor.test.ts` | Passed | 6 tests cover provider discovery readiness and manual-default-specific health. |
| `pnpm --filter @tj/api exec vitest run tests/smoke.test.ts` | Passed | 36 tests, including stale-agent restart recovery. |
| `pnpm --filter @tj/api exec vitest run tests/orchestrator.test.ts` | Passed | 19 tests, including explicit TJ-source targeting versus ordinary TJ acceptance goals. |
| `pnpm --filter @tj/api exec vitest run tests/provider-setup-acceptance.test.ts` | Passed | Mocked upstream verified streamed deltas, completion metadata, routing trace, provider setup, and four ordered conversation messages with the final model trace persisted across API close/restart. |
| `pnpm run typecheck` | Passed | Schemas, web and API typechecks completed. |
| `pnpm run lint` | Passed | Repository ESLint clean; fixed ZIP completion helper’s standalone ternary expression without disabling rules. |
| `pnpm run build` | Passed | Schemas, web, API production build. Existing Zod annotation and 927.52 KB lazy 3D chunk warnings remain. |
| `pnpm run build:desktop` | Passed | Tauri `cargo check` completed. |
| `pnpm run package` | Passed | Latest build generated MSI (36.04 MiB) and NSIS (24.60 MiB) installers with bundled Node/API assets; not installed. |
| Browser route sweep | Passed | Visited 25 routes; no page exceptions or HTTP 5xx responses. |
| Browser conversation-mode persistence | Passed | AUTO, CHAT, BUILD, and IMPROVE survived navigation/reload; a second conversation retained BUILD while `hello` remained AUTO. An unsent BUILD draft survived navigation/reload without switching to the newest saved conversation. Temporary thread and local-storage keys were removed afterward. |
| Browser conversation-mode persistence | Passed | AUTO, CHAT, BUILD, and IMPROVE each remained selected after navigating to Main Interface and back, then reloading and reopening the same conversation. Temporary test mode storage was removed and the existing conversation restored to AUTO. |
| Live FreeLLM connection | Passed | Test connection authenticated through TJ’s vault and discovered 499 models; no inference verification was triggered. |
| Live browser chat | Passed | One real test reply persisted with model `prov_d2993e02/auto`, routed model `prov_d2993e02/qwen-flash-character`, latency 801 ms, and `cost_usd: null` (unknown pricing). |
| Live STOP ALL | Passed | UI showed STOPPED; chat endpoint returned 403 while stopped; UI Resume restored operation. |
| Tauri dev | Started | `tj-desktop.exe` process launched and reused the running local API. A brief Vite proxy refusal occurred during an API watch restart; final API/web listeners were available. |
| Final FreeLLM readiness refresh | Passed | Vault-authenticated Test connection/discovery succeeded; API reports database and model_router healthy and the browser updated to SYSTEM READY. No new inference check was triggered. |

Not verified: installer first-run/database initialization/restart/recovery, ChatGPT OAuth token exchange (no account or sign-in consent), calendar/Gmail OAuth automation, microphone/device acceptance, and cost for FreeLLM inference.

## Parallel worker evidence

Three read-only Explore workers were actually launched. They inspected the public remote snapshot, not the local checkout; their findings are not treated as local verification evidence. No subagent edits were made.