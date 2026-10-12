# TJ source-runtime smoke acceptance (read-only)

This is an **early baseline**, not certification of the full 93-section master prompt. It runs GET requests against the **real API process**, checking database health and the existence/shape of system, provider, agent, Agent Town, workflow and Activity endpoints, plus the SSE response headers.

## On the user's separate Windows test clone

From `C:\Projects\TJ-GitHub-Test`, with `pnpm run dev` already running in another PowerShell window:

```powershell
pnpm run test:runtime
```

The check targets only `http://127.0.0.1:4780` by default and prints **no API response bodies, account information, or credentials**. `TJ_LOCAL_API_URL` can select another **loopback-only** HTTP origin. A missing model is reported as `MODEL NEEDS_SETUP`, not counted as a healthy model, and does not conceal successful basic API boot.

If the running server is not listening, start it first with `pnpm run dev`. The script does **not** create agents, send LLM prompts, modify settings, spend money, publish externally, or inspect local user files.

## Isolated build acceptance in CI

```powershell
pnpm run build
pnpm run test:runtime:isolated
```

The `--isolated` variant launches the actual production Node API build on a temporary loopback port with an ephemeral SQLite directory, then terminates the child and removes its test data. It is run in Linux and Windows CI after build.

## Evidence boundaries

- A passing smoke establishes that a built API starts, SQLite initializes, read-only endpoint schemas respond, and the SSE endpoint can be established.
- It does **not** establish model inference quality, authenticated cloud integrations, durable autonomous project delivery (§84), human voice, Windows desktop/computer control, UI visuals, installed application startup (§88), or full functional acceptance.
- Live local-model chat requires a running Ollama, LM Studio or other compatible model server and an explicitly configured provider. Real user-account tests require the user's own authorization.
- In the fresh clone, test the UI separately at `http://localhost:5173` and record screenshots/error logs only after removing secrets. Test Chat/Auto/Build/Improve mode persistence, thread switching, agent orchestration, workflow pause/resume, permission approvals and STOP ALL using disposable tasks.

No audit classification should change solely because this script or CI passes.
