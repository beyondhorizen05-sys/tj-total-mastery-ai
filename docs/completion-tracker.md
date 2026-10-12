# Mission 001 Completion Tracker

## Current status

Mission 001 is in progress and is not complete. The checked-in audit documents 3 Working, 85 Partial, 4 Unverified, and 1 Unmet sections. These classifications have not been comprehensively re-established by fresh acceptance evidence in this run.

## Verified in this run

- Removed automatic per-model inference verification from the provider UI while retaining Test connection and Discover. A successful provider test/discovery now activates an available text route if the saved default is unavailable; a healthy user-selected default and routing mode are preserved.
- Added explicit “Remember this model” consent for paid inference, scoped to the exact model target. `Approve once` remains one-use; sensitive tool permissions are unchanged. The router regression covers 20 consecutive calls after durable model authorization and separately verifies one-time semantics.
- Added direct-chat SSE deltas and incremental rendering in both chat surfaces. The HTTP provider acceptance uses a mock upstream to verify delta events, completion metadata, and persisted assistant history.
- Extended provider acceptance through an API close/restart: both the ordinary response and streamed response remain in the same conversation, in order, with routed-model trace preserved.
- Persisted AUTO, CHAT, BUILD, and IMPROVE selection per conversation in browser storage, with a separate unsent-draft mode and active-thread marker. All four modes survived navigation and reload. A disposable second conversation retained BUILD independently while `hello` remained AUTO across switching/reload; an unsent BUILD draft also survived navigation/reload instead of reverting to the newest saved thread. Temporary threads/preferences were removed afterward.
- Narrowed internal-repository routing to explicit TJ source/repository goals. This fixed the §84 acceptance fixture’s accidental repository-root write; the exact pre-test `package.json` was restored from the test backup and the three generated root test files were removed.
- Fixed startup recovery to reset agents whose tasks disappeared during restart. The live orphan agent returned to idle; system status no longer reports stale execution.
- Fixed short-height Main Interface panel collisions by enabling the existing flowing layout below 620px viewport height.
- Live runtime: API and web started; FreeLLM Test connection and discovery succeeded using the vaulted credential, 499 models were discovered, and Auto was restored as the manual default. A real browser chat reply completed in 801ms, persisted with route `custom/qwen-flash-character`, 196 input tokens, 8 output tokens, and unknown cost. No approval remained pending.
- STOP ALL was tested live with no active tasks/workflows: the UI showed STOPPED, chat returned HTTP 403, then Resume restored operation.
- Browser smoke visited 25 workspace routes with no fresh page exceptions or HTTP 5xx responses. Model selection was changed to a discovered model and restored to Auto.
- Verification: API unit suite 47 files / 274 tests; E2E suite 2 files / 6 tests; workspace typecheck, full lint, production build, desktop Cargo check, and package generation passed.
- Tauri dev `tj-desktop.exe` remains running; MSI (36.04 MiB) and NSIS (24.60 MiB) installers were generated with bundled Node/API assets. Installers were not installed.

## Active requirements and blockers

- Chat streaming and persisted history passed the mocked HTTP acceptance; one actual FreeLLM browser turn also passed. Real provider-backed planning and full §84 live-provider/browser delivery remain unverified.
- ChatGPT sign-in is enabled but no account is connected; the reported token-exchange 400 was not reproduced, and no OAuth attempt was initiated because it requires user authentication and consent.
- Calendar/Gmail scheduled automation still requires live OAuth and a connected external account.
- Tauri dev and package generation pass, but installed clean-start, first-run database initialization, restart, and recovery remain unverified.
- Conversation modes pass browser navigation/reload acceptance; full Tauri-process restart mode persistence and cross-conversation mode switching still need acceptance.
- Full prompt acceptance remains incomplete; no audit section is promoted based on this bounded fix.
- Chat mode state is verified across browser view remount/navigation, reload, and conversation switching. Persistence across a full Tauri process restart remains unverified.

## Parallel work

- Three read-only Explore workers were dispatched for desktop packaging, chat/streaming, and audit acceptance gaps. They returned findings from a remote repository snapshot rather than the dirty local checkout, so those findings were not used as local-state evidence and their output caused no edits.
- One local implementation workstream completed the bounded model-approval reuse change. No concurrent writers were launched to avoid conflicts with the extensively modified worktree.

## Next eligible work

1. Obtain user-approved ChatGPT OAuth consent to reproduce and diagnose any token-exchange 400.
2. Install and exercise a generated desktop package, including first run, database initialization, restart, and recovery.
3. Run configured-provider §84 end-to-end delivery and live scheduled OAuth automation acceptance.
4. Continue section-by-section acceptance without promoting classifications absent evidence.