# Universal model compatibility acceptance ledger — October 12, 2026

Branch: feat/universal-model-compatibility. Pull request #1.

## Implemented and regression-tested
Shared provider adapters preserved; native and emulated tool calls validated by application and permission-gated tool registry; model metadata and price parsing; free/local-only mode; separate cross-provider and paid-cross-provider fallback consents; model capacity limits; bounded retries and circuit breakers; incomplete result detection; conservative context limits; cancellation; durable future-step workflow model override; per-agent model assignment; risk-sensitive non-replay; automatic model discovery after user setup; persistent Chat/Auto/Build/Improve selection.

## Still UNVERIFIED or incomplete
Real provider model capabilities, multimodal audio/vision, live cross-provider tool calling, model-account quotas/paid-rate tests, device permissions, true tokenization per provider, summarization-based context compression, durable agent conversation checkpoints, database-backed idempotency keys for arbitrary external actions, long-lived streaming with network interruptions, full heterogeneous multi-agent execution and the 15-stage master-prompt end-to-end scenario.

No universal compatibility certification is issued. Mocked acceptance tests are not live-provider acceptance. Workflow recovery fails closed when an uncertain external side effect could be duplicated. User-authorized provider connections and device access are required for live validation.


## 2026-10-12 — Windows installed-runtime script availability (§16, §19, §88)

Implementation on this branch: package the checked-in Windows computer bridge, Windows speech listener/speaker/voice catalog, and optional local-ASR Python worker with the API bundle. Resolve runtime script paths beside the installed `main.js` when the desktop token-file launch mode is active, while preserving repository paths for development. The Windows bundled-API smoke now fails if any required script is absent, in addition to its existing authenticated/unauthenticated API checks. Added pure path-resolution regression coverage for both development and packaged layouts.

**Evidence boundary:** This change fixes a known source-level packaging omission; it does **not** prove that PowerShell, optional Python speech dependencies, Windows device grants, or a clean-machine installer work. The Windows CI smoke and installer jobs must pass on the resulting commit; clean-machine UI and device acceptance remain required. No §16/§19/§88 audit status is upgraded.
