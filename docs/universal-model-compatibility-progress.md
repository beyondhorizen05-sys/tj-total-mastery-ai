# Universal model compatibility — implementation increment

Branch: feat/universal-model-compatibility, targeting master.

## Implemented

- Agent runtime permits a bounded JSON tool protocol for providers whose discovered model lacks native tool calling. The application translates the assistant proposal to a normal tool request, and the existing ToolRegistry remains authoritative for permissions, approvals and execution.
- Both native and emulated tool requests must name a tool available to the agent and validate argument types, required keys, oversized values, nested structures and unsafe keys before execution.
- Model router still respects an explicitly chosen model (no silent alternate or paid fallback on that choice). It may use an emulated protocol only when an agent explicitly permits it.
- Ollama reads declared capabilities through /api/show; undiscovered capabilities are not inferred from model names.
- Chat/Auto/Build/Improve mode in Chat persists across component remounts.
- A CI workflow runs typecheck, lint, tests and build on GitHub Actions.

## Not proven / not implemented

This is a bounded compatibility increment, not universal certification. Cross-provider spending authorization, durable model-switch checkpoints, per-model streaming tool-call verification, context compression, persistent action idempotency, hardware-aware scheduling, end-to-end heterogeneous multi-agent scenarios, multimodal live input, and the full master prompt are pending. Any GitHub CI runs should be interpreted separately from live-provider tests. The section-level audit status remains unchanged until independently demonstrated.

## Security limitations

The emulated JSON protocol cannot make a model trustworthy. ToolRegistry approval and permissions are mandatory. The schema validator covers common JSON Schema keywords but is not a complete JSON Schema implementation; extensions should use a full schema compiler and deny unsupported/ambiguous schemas where appropriate.
