# Model execution log

| Date | Task | Preferred | Actual | Reasoning | Mode | Validation / issue |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-10-09 | Inspect Codex routing support | Astra | Current conversation model not exposed to project script | Unobservable | Manual CLI inspection | `codex-cli 0.155.0-alpha.16.4`; `codex exec --model` and `--worktree` supported; account access for new CLI sessions unverified. |
| 2026-10-09 | Theme layouts and capability workflow already in progress | Sol 6.1 / Astra | Agent models not reported to project script | Unobservable | Existing Codex agent sessions | No model attribution inferred. See application tests in task report. |
| 2026-10-09 | High-risk capability workflow, repair, and router review | `gpt-6-astra` | `gpt-6-astra` (Codex subagent model selection confirmed) | high | Separate read-only agent | Found shell injection, duplicate task resume, STOP ALL race, and interrupted repair rollback hash; fixes and focused regression tests added. |

New `route.mjs --run` sessions append their observed execution result here. A requested model is never recorded as actual without CLI evidence.

| 2026-10-10 | §83 self-improvement reliability acceptance | Policy: Astra for security/integration review; active-session model not exposed | Runtime ID unobservable | Unobservable | Manual implementation and isolated tests | Selected files in isolated candidates now begin from the user's current working tree, preserving same-file uncommitted edits; persisted deployment approvals resume after service restart. Regression tests 16/16, smoke + self-improvement 6/6, API/web typechecks, API/web production builds, and API HTTP E2E pass. No provider-generated source edit was run; §83 remains Partial for autonomous telemetry analysis and live provider acceptance. |
