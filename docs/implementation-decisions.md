# Mission 001 Implementation Decisions

## Model Approval Semantics

- Root cause: paid-model inference required approval, but the UI had only a one-time action and repeated turns could prompt again.
- Added an explicit `Remember this model` action only for `model.inference` approvals. It persists the existing `approved_workflow` state for the exact action, target model ID, and `payments.execute` permission. `approve_once` is intentionally not reusable.
- This does not authorize other models or any tool operation; tool permissions and high-risk gates remain unchanged. No global approval bypass was added.
- Verification: router tests exercise 20 consecutive calls after durable model consent and assert a one-time grant produces a fresh subsequent approval.

## Provider Readiness And Streaming

- Removed automatic `/models/verify` inference calls from Test connection and Discover. A real provider connection plus model catalog activates a text route without a paid probe; current routing mode and a healthy saved default are preserved.
- Health reports provider reachability/discovery separately from historical model success, and manual-mode status only evaluates the saved default. Stale health remains unverified.
- Direct chat accepts SSE and relays provider deltas plus persisted completion metadata. The web Chat and shared interaction surfaces render deltas; orchestration JSON responses remain supported as a fallback.

## Verification and scope

- The internal-source detector now requires explicit TJ source/repository intent. Ordinary tasks mentioning TJ and a build no longer select the repository root; §84 E2E asserts scratch-directory isolation.
- API startup resets agents left active after a missing/interrupted task. STOP ALL live acceptance confirms chat is rejected while stopped and resumes normally.
- Main Interface reflows on short viewports to avoid absolute-position overlap.
- Full tests, E2E, typecheck, lint, production build, desktop build, and package generation pass. Installer installation and first-run/restart acceptance remain outstanding.
- No master-prompt section was reclassified based on this run.
- Parallel read-only workers inspected a remote snapshot that did not match the local checkout; their findings were not used to guide local edits.