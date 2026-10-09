# Development model routing

This policy applies to Codex development sessions, not TJ customer AI providers.

Model tier descriptions follow the [official OpenAI model catalog](https://developers.openai.com/api/docs/models). Catalog listing does not establish access in a specific Codex account.

| Task | Preferred | Available fallback on this host | Reasoning |
| --- | --- | --- | --- |
| Architecture, security, complex integration, regression review | `gpt-6-astra` | `gpt-6-sol` | high |
| Substantial React, TypeScript, 3D, voice, visual implementation | `gpt-6.1-sol` | `gpt-6-sol` | medium |
| Documentation, simple styling, routine tests | `gpt-6-luna` | `gpt-6-sol` | low |

Codex CLI 0.155.0-alpha.16.4 supports `codex exec --model` and `--worktree`. On 2026-10-09 the desktop tool metadata exposed `gpt-6-astra`, `gpt-6-sol`, and `gpt-6-luna`; it did not expose `gpt-6.1-sol`. This is an interface list, not proof that this account can execute every listed model. A run is attributed to a model only after the CLI reports its actual model. The current conversation's model cannot be switched by this script.

The router classifies each bounded task by its requested kind and risk. It refuses a run with a dirty shared checkout, launches in a separate Codex worktree, and records the session result. Apply generated changes only after reviewing the diff and validation. Separate tasks may run concurrently when their file scopes do not overlap. High-risk changes require Astra review before release acceptance when accessible.

Usage: `node development/model-orchestrator/route.mjs --task "Build X" --files apps/web/src/views/X.tsx` to preview automatic classification; add `--run` to execute. Use `--kind` to correct a classification and `--model` to request a specific exposed model. The CLI itself checks account model access at execution; an access failure is logged and does not trigger a silent substitution. No paid service or subscription is created by this script.
