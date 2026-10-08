# TJ — Total Mastery AI

**Status:** active development. The web UI and local API run today; many master-prompt capabilities are partial or require external accounts. See [the section audit](docs/master-prompt-audit.md) before relying on a capability. The Tauri desktop installer is not yet a complete distribution of the API.

TJ is released under the [MIT License](LICENSE). Do not commit `.env`, `.tj-data`, API keys, OAuth tokens, personal databases, or vault files. Report security issues privately as described in [SECURITY.md](SECURITY.md).

> Local-first AI operating environment: multi-agent autonomous orchestration, durable DAG workflows, hybrid FTS5/vector memory, encrypted vault secrets, sandboxed execution, and human-in-the-loop action governance.

---

## ⚡ Architecture Overview

```
TJ Monorepo Architecture
│
├── apps/
│   ├── web/        ── React 19 + Vite dashboard (Live Orb, Chat, Agents, Workflows, Capabilities, Approvals)
│   └── desktop/    ── Tauri cross-platform shell scaffold
│
├── services/
│   └── api/        ── Fastify backend running on Node 22+ with node:sqlite (WAL mode)
│       ├── agents/       ── Autonomous specialized agents with bounded tool loops
│       ├── cognitive/    ── Planner, critic, validator, and repair loops
│       ├── connectors/   ── External integrations (Tavily, Brave, GitHub, OpenWeather, Slack, HA)
│       ├── core/         ── Capabilities matrix, health monitor, event bus, workspace manager
│       ├── db/           ── Versioned SQLite migrations (FTS5 + JSON1)
│       ├── memory/       ── Hybrid memory store (FTS5 BM25 + vector similarity)
│       ├── models/       ── ModelRouter with multi-provider fallback & failover
│       ├── orchestrator/ ── Dependency-ordered parallel task execution engine
│       ├── security/     ── AES-256-GCM Vault, Permission Engine, Approval Gate
│       ├── tools/        ── Sandboxed filesystem, command execution, memory, web fetch
│       └── workflows/    ── Durable DAG engine with Croner automation scheduler
│
└── packages/
    └── schemas/    ── Shared Zod schemas and TypeScript domain contracts
```

---

## 🛡️ Core Security & Absolute Guarantees

1. **Permission Engine**: Autonomy levels (1: Read-Only, 2: Draft, 3: Supervised, 4: Autonomous). Tool actions are checked against permissions and approval policies.
2. **Encrypted Vault**: All provider keys and connector tokens are encrypted with AES-256-GCM. Plaintext secrets are never stored in database rows or leaked to log streams.
3. **STOP ALL Killswitch**: One-click immediate killswitch halts all active task runs, aborts model generation, rejects pending approvals, and resets agent states to idle.
4. **Sandboxed Tools**: Path traversal attempts (relative dot-dot navigation, root escapes, system paths) are blocked with strict containment validation.

---

## 🚀 Quickstart

### Prerequisites
- Node.js >= 22.13.0
- pnpm >= 10.0.0

### Installation & Database Setup
```bash
# Clone and enter directory
cd tj-total-mastery-ai

# Install dependencies across all workspace packages
pnpm install

# Run database migrations (creates SQLite tables with WAL mode & FTS5)
pnpm run migrate
```

### Running Development Servers
```bash
# Run both API and Web UI concurrently
pnpm run dev

# Or run separately:
pnpm run dev:api  # Runs API at http://127.0.0.1:4780
pnpm run dev:web  # Runs Vite UI at http://localhost:5173
```

---

## 🧪 Testing & Verification

```bash
# Run all unit and integration test suites
pnpm run test

# Typecheck all packages
pnpm run typecheck

# Build for production
pnpm run build
```
