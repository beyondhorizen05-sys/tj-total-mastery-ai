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

    list.push({
      capability_id: 'core.db', name: 'SQLite + FTS5 Database', domain: 'core',
      description: 'Local-first relational store with full-text search', status: 'AVAILABLE',
      provider: 'node:sqlite', required_permissions: [], required_credentials: [],
      health: 'healthy', latency_ms: 1, version: '1.0.0', implementation: 'node:sqlite WAL',
      missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'core.vault', name: 'AES-256-GCM Vault', domain: 'security',
      description: 'Encrypted secret storage with master key', status: 'AVAILABLE',
      provider: 'crypto', required_permissions: [], required_credentials: [],
      health: 'healthy', latency_ms: 1, version: '1.0.0', implementation: 'aes-256-gcm',
      missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'core.permissions', name: 'Permission & Approval Engine', domain: 'security',
      description: 'Granular policy gating and human approval loop', status: 'AVAILABLE',
      provider: 'internal', required_permissions: [], required_credentials: [],
      health: 'healthy', latency_ms: 1, version: '1.0.0', implementation: 'PermissionEngine + ApprovalService',
      missing: null, ui: true, tests: true,
    });

    const candidates = this.deps.router.candidates({ task_type: 'chat' });
    const hasActive = candidates.length > 0;
    list.push({
      capability_id: 'models.chat', name: 'Chat Completion Router', domain: 'models',
      description: 'Multi-provider routing with fallback and retry',
      status: hasActive ? 'AVAILABLE' : 'NEEDS_API_KEY', provider: candidates[0]?.display_name ?? candidates[0]?.model ?? null,
      required_permissions: ['model.infer'], required_credentials: ['apiKey or Ollama host'],
      health: hasActive ? 'healthy' : 'misconfigured', latency_ms: null, version: '1.0.0',
      implementation: 'ModelRouter', missing: hasActive ? null : 'Configure at least one model provider',
      ui: true, tests: true,
    });

    list.push({
      capability_id: 'tools.fs', name: 'Filesystem Tools', domain: 'files',
      description: 'Read, write, list files with path containment and backups',
      status: 'AVAILABLE', provider: 'node:fs', required_permissions: ['fs.read', 'fs.write'],
      required_credentials: [], health: 'healthy', latency_ms: 1, version: '1.0.0',
      implementation: 'FsReadTool / FsWriteTool', missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'tools.shell', name: 'Command Execution Tool', domain: 'shell',
      description: 'Execute shell commands inside workspace with timeout & kill-switch',
      status: 'AVAILABLE', provider: 'node:child_process', required_permissions: ['cmd.execute'],
      required_credentials: [], health: 'healthy', latency_ms: 5, version: '1.0.0',
      implementation: 'CommandExecuteTool', missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'tools.web_fetch', name: 'HTTP Fetch Tool', domain: 'tools',
      description: 'Fetch and parse text from public URLs', status: 'AVAILABLE',
      provider: 'node:fetch', required_permissions: ['network.http'], required_credentials: [],
      health: 'healthy', latency_ms: null, version: '1.0.0', implementation: 'WebFetchTool',
      missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'memory.hybrid', name: 'Hybrid Memory Store', domain: 'memory',
      description: 'FTS5 BM25 search + vector similarity ranking', status: 'AVAILABLE',
      provider: 'node:sqlite FTS5', required_permissions: ['memory.read', 'memory.write'],
      required_credentials: [], health: 'healthy', latency_ms: 2, version: '1.0.0',
      implementation: 'MemoryService', missing: null, ui: true, tests: true,
    });
    list.push({
      capability_id: 'workflows.engine', name: 'DAG Workflow Engine', domain: 'workflows',
      description: 'Parallel DAG execution with pause/resume, retry, timeout, crash recovery',
      status: 'AVAILABLE', provider: 'internal', required_permissions: ['workflow.run'],
      required_credentials: [], health: 'healthy', latency_ms: 1, version: '1.0.0',
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
