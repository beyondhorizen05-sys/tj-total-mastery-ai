import type { Capability, CapabilityDomain } from '@tj/schemas';
import type { Database } from '../db/database.js';
import type { ModelRouter } from '../models/router.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ConnectorService } from '../connectors/service.js';
import type { Vault } from '../security/vault.js';

export interface CapabilityRegistryDeps {
  db: Database;
  router: ModelRouter;
  tools: ToolRegistry;
  connectors: ConnectorService;
  vault: Vault;
}

export class CapabilityRegistry {
  constructor(private deps: CapabilityRegistryDeps) {}

  async list(): Promise<Capability[]> {
    const list: Capability[] = [];
    let databaseReady = false;
    let databaseLatency: number | null = null;
    try { const started = performance.now(); this.deps.db.get('SELECT 1'); databaseLatency = Math.round(performance.now() - started); databaseReady = true; } catch { /* report database failure */ }

    list.push({
      capability_id: 'core.db', name: 'SQLite Database', domain: 'core',
      description: `Local relational store${this.deps.db.ftsAvailable ? ' with FTS5 indexing' : ' with basic text search'}`, status: databaseReady ? 'AVAILABLE' : 'UNAVAILABLE',
      provider: 'node:sqlite', required_permissions: [], required_credentials: [],
      health: databaseReady ? 'healthy' : 'offline', latency_ms: databaseLatency, version: '1.0.0', implementation: 'node:sqlite',
      missing: databaseReady ? null : 'Database query failed', ui: true, tests: true,
    });
    list.push({
      capability_id: 'core.vault', name: 'AES-256-GCM Vault', domain: 'security',
      description: 'Encrypted secret storage with master key', status: 'AVAILABLE',
      provider: 'crypto', required_permissions: [], required_credentials: [],
      health: 'unknown', latency_ms: null, version: '1.0.0', implementation: 'aes-256-gcm',
      missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'core.permissions', name: 'Permission & Approval Engine', domain: 'security',
      description: 'Granular policy gating and human approval loop', status: 'AVAILABLE',
      provider: 'internal', required_permissions: [], required_credentials: [],
      health: 'unknown', latency_ms: null, version: '1.0.0', implementation: 'PermissionEngine + ApprovalService',
      missing: null, ui: true, tests: true,
    });

    const candidates = this.deps.router.candidates({ task_type: 'chat' });
    const hasActive = candidates.length > 0;
    const workingModel = candidates.find((model) => model.health === 'healthy');
    const failedModel = candidates.find((model) => model.health === 'degraded' || model.health === 'offline');
    const unverifiedModel = candidates.find((model) => model.health === 'unknown');
    const chatStatus = workingModel ? 'AVAILABLE' : unverifiedModel ? 'NEEDS_SETUP' : hasActive ? 'UNAVAILABLE' : 'NEEDS_API_KEY';
    list.push({
      capability_id: 'models.chat', name: 'Chat Completion Router', domain: 'models',
      description: 'Multi-provider routing with fallback and retry',
      status: chatStatus, provider: candidates[0]?.display_name ?? candidates[0]?.model ?? null,
      required_permissions: ['model.infer'], required_credentials: ['apiKey or Ollama host'],
      health: workingModel ? 'healthy' : unverifiedModel ? 'unknown' : failedModel ? 'degraded' : 'misconfigured', latency_ms: null, version: '1.0.0',
      implementation: 'ModelRouter', missing: workingModel ? null : unverifiedModel ? 'No successful inference verified yet; some models have failed previously' : failedModel ? 'Recent model inference failed; inspect Models and Activity' : 'Configure at least one model provider',
      ui: true, tests: true,
    });

    const fileToolsReady = ['fs_read', 'fs_write', 'fs_list'].every((id) => Boolean(this.deps.tools.get(id)));
    list.push({
      capability_id: 'tools.fs', name: 'Filesystem Tools', domain: 'files',
      description: 'Read, write, list files with path containment and backups',
      status: fileToolsReady ? 'AVAILABLE' : 'UNAVAILABLE', provider: 'node:fs', required_permissions: ['filesystem.read', 'filesystem.write'],
      required_credentials: [], health: fileToolsReady ? 'unknown' : 'misconfigured', latency_ms: null, version: '1.0.0',
      implementation: 'FsReadTool / FsWriteTool', missing: fileToolsReady ? null : 'Filesystem tools are not registered', ui: true, tests: true,
    });
    list.push({
      capability_id: 'tools.shell', name: 'Command Execution Tool', domain: 'shell',
      description: 'Execute shell commands inside workspace with timeout & kill-switch',
      status: this.deps.tools.get('shell_exec') ? 'AVAILABLE' : 'UNAVAILABLE', provider: 'node:child_process', required_permissions: ['cmd.execute'],
      required_credentials: [], health: 'unknown', latency_ms: null, version: '1.0.0',
      implementation: 'CommandExecuteTool', missing: this.deps.tools.get('shell_exec') ? null : 'Command tool is not registered', ui: true, tests: true,
    });
    list.push({
      capability_id: 'tools.web_fetch', name: 'HTTP Fetch Tool', domain: 'tools',
      description: 'Fetch and parse text from public URLs', status: this.deps.tools.get('web_fetch') ? 'AVAILABLE' : 'UNAVAILABLE',
      provider: 'node:fetch', required_permissions: ['network.http'], required_credentials: [],
      health: 'unknown', latency_ms: null, version: '1.0.0', implementation: 'WebFetchTool',
      missing: this.deps.tools.get('web_fetch') ? null : 'Web fetch tool is not registered', ui: true, tests: true,
    });
    list.push({
      capability_id: 'memory.keyword', name: 'Memory Search', domain: 'memory',
      description: this.deps.db.ftsAvailable ? 'FTS5 keyword search with BM25 ranking' : 'Basic keyword search; FTS5 unavailable', status: databaseReady ? 'AVAILABLE' : 'UNAVAILABLE',
      provider: 'node:sqlite FTS5', required_permissions: ['memory.read', 'memory.write'],
      required_credentials: [], health: databaseReady ? 'unknown' : 'offline', latency_ms: null, version: '1.0.0',
      implementation: 'MemoryService', missing: databaseReady ? null : 'Database unavailable', ui: true, tests: true,
    });
    const embeddedCount = this.deps.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM memories WHERE has_embedding = 1')?.count ?? 0;
    list.push({
      capability_id: 'memory.semantic', name: 'Semantic Memory Search', domain: 'memory',
      description: 'Vector similarity search over stored memory embeddings', status: embeddedCount > 0 ? 'EXPERIMENTAL' : 'NEEDS_SETUP',
      provider: null, required_permissions: ['memory.read'], required_credentials: ['Embedding-capable model'],
      health: 'unknown', latency_ms: null, version: '1.0.0', implementation: 'MemoryService',
      missing: embeddedCount > 0 ? 'Embedding provider availability has not been verified in this view' : 'No embedded memories yet; configure an embedding model and save memory', ui: true, tests: true,
    });
    list.push({
      capability_id: 'workflows.engine', name: 'DAG Workflow Engine', domain: 'workflows',
      description: 'Parallel DAG execution with pause/resume, retry, timeout, crash recovery',
      status: 'AVAILABLE', provider: 'internal', required_permissions: ['workflow.run'],
      required_credentials: [], health: 'unknown', latency_ms: null, version: '1.0.0',
      implementation: 'WorkflowEngine', missing: null, ui: true, tests: true,
    });

    const connectors = await this.deps.connectors.list();
    for (const c of connectors) {
      list.push({
        capability_id: `connector.${c.id}`, name: c.name, domain: (c.category as CapabilityDomain) || 'connectors',
        description: c.description, status: c.status, provider: c.provider, required_permissions: c.permissions,
        required_credentials: c.missing ? [c.missing] : [], health: c.health, latency_ms: null,
        version: c.version, implementation: `ConnectorRuntime (${c.id})`, missing: c.missing, ui: true, tests: true,
      });
    }

    for (const p of this.deps.connectors.getPlanned()) {
      list.push({
        capability_id: `planned.${p.id}`, name: p.name, domain: (p.category as CapabilityDomain) || 'connectors',
        description: p.note, status: 'PLANNED', provider: p.name, required_permissions: [],
        required_credentials: [], health: 'unknown', latency_ms: null, version: '0.0.0',
        implementation: 'Planned integration', missing: p.note, ui: true, tests: false,
      });
    }

    return list;
  }
}
