import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CapabilityWorkflowService } from '../src/self-improvement/capability-workflow.js';
import Fastify from 'fastify';
import { registerChatRoutes } from '../src/server/routes/chat.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

function harness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-capability-'));
  directories.push(dataDir);
  let items = [
    { capability_id: 'tools.fs', name: 'Files', description: 'Read and write files', status: 'AVAILABLE', missing: null },
    { capability_id: 'planned.shopify', name: 'Shopify', description: 'Manage store products', status: 'PLANNED', missing: 'Not implemented' },
  ];
  const approval = { id: 'approval-1', status: 'pending', payload: {} as Record<string, unknown> };
  const approvals = {
    request: vi.fn((input: { payload: Record<string, unknown> }) => { approval.payload = input.payload; return approval; }),
    get: vi.fn(() => approval),
    waitFor: vi.fn(() => new Promise(() => {})),
  };
  const improvements = {
    start: vi.fn(async () => ({ id: 'run-1' })),
    get: vi.fn(() => ({ id: 'run-1', state: 'completed', files: ['services/api/src/connectors/service.ts'], error: null, stage: 'passed' })),
  };
  const router = { candidates: vi.fn(() => [{}]), chat: vi.fn(async () => ({ text: JSON.stringify({ capability_id: 'planned.shopify', reason: 'Store integration is planned.' }) })) };
  const orchestrator = {
    prepare: vi.fn(() => ({ id: 'prepared' })),
    execute: vi.fn(async () => ({ status: 'completed', summary: 'Product updated', evidence: { gaps: [] } })),
  };
  const ws = { workspaceId: 'workspace-1', addMessage: vi.fn() };
  const deps = {
    dataDir,
    capabilities: { list: vi.fn(async () => items) }, router, approvals, improvements,
    ws, health: { isStopped: vi.fn(() => false) },
    cognitive: { plan: vi.fn(async () => ({ plan: { tasks: [] }, source: 'model' })) }, orchestrator,
  };
  return { deps, approval, approvals, improvements, router, orchestrator, ws, setItems: (next: typeof items) => { items = next; } };
}

describe('capability addition workflow', () => {
  it('chat returns approval before planning or executing a task with a detected gap', async () => {
    const app = Fastify();
    const plan = vi.fn();
    const execute = vi.fn();
    const addMessage = vi.fn();
    registerChatRoutes(app, {
      ws: { createConversation: () => ({ id: 'conversation-1' }), addMessage, messages: () => [] },
      router: { chat: vi.fn() }, cognitive: { plan }, orchestrator: { execute },
      health: { isStopped: () => false, setState: vi.fn() }, settings: {},
      capabilityWorkflow: {
        assess: async () => ({ capability_id: 'planned.shopify', capability_name: 'Shopify', reason: 'Integration is planned.' }),
        request: () => ({ id: 'approval-1' }),
      },
    } as never);
    const response = await app.inject({ method: 'POST', url: '/api/v1/chat', payload: { content: 'Update my Shopify product', mode: 'auto' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'approval_required', approval_id: 'approval-1', capability_id: 'planned.shopify' });
    expect(plan).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(addMessage).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('does not request approval when classifier selects an available ability', async () => {
    const { deps, router, approvals } = harness();
    router.chat.mockResolvedValueOnce({ text: '{"capability_id":"tools.fs","reason":"files"}' });
    const service = new CapabilityWorkflowService(deps as never);
    expect(await service.assess('Write a file')).toBeNull();
    expect(approvals.request).not.toHaveBeenCalled();
    service.dispose();
  });

  it('requires approval, persists activation state, and resumes the original task after restart', async () => {
    const { deps, approval, approvals, improvements, orchestrator, setItems } = harness();
    const service = new CapabilityWorkflowService(deps as never);
    const gap = await service.assess('Update my Shopify product');
    expect(gap?.capability_id).toBe('planned.shopify');
    service.request({ request: 'Update my Shopify product', ...gap!, conversation_id: 'conversation-1', project_id: null, model_id: null });
    expect(approvals.request).toHaveBeenCalledOnce();
    expect((await service.progress(approval.id))?.status).toBe('pending_approval');
    expect(improvements.start).not.toHaveBeenCalled();
    approval.status = 'approved';
    expect((await service.progress(approval.id))?.status).toBe('awaiting_activation');
    expect(orchestrator.execute).not.toHaveBeenCalled();
    setItems([
      { capability_id: 'tools.fs', name: 'Files', description: 'Read and write files', status: 'AVAILABLE', missing: null },
      { capability_id: 'planned.shopify', name: 'Shopify', description: 'Manage store products', status: 'AVAILABLE', missing: null },
    ]);
    const originalList = deps.capabilities.list;
    let releaseList!: () => void;
    const listGate = new Promise<void>((resolve) => { releaseList = resolve; });
    deps.capabilities.list = vi.fn(async () => { await listGate; return originalList(); });
    const restarted = new CapabilityWorkflowService(deps as never);
    const first = restarted.progress(approval.id);
    const second = restarted.progress(approval.id);
    releaseList();
    await Promise.all([first, second]);
    const status = await restarted.progress(approval.id);
    expect(status?.status).toBe('completed');
    expect(orchestrator.execute).toHaveBeenCalledOnce();
    expect(improvements.start).toHaveBeenCalledOnce();
    service.dispose();
    restarted.dispose();
  });

  it('does not start the original task when STOP ALL arrives during planning', async () => {
    const { deps, approval, setItems, orchestrator } = harness();
    const service = new CapabilityWorkflowService(deps as never);
    const gap = await service.assess('Update my Shopify product');
    service.request({ request: 'Update my Shopify product', ...gap!, conversation_id: 'conversation-1', project_id: null, model_id: null });
    approval.status = 'approved';
    expect((await service.progress(approval.id))?.status).toBe('awaiting_activation');
    setItems([
      { capability_id: 'tools.fs', name: 'Files', description: 'Read and write files', status: 'AVAILABLE', missing: null },
      { capability_id: 'planned.shopify', name: 'Shopify', description: 'Manage store products', status: 'AVAILABLE', missing: null },
    ]);
    let stopped = false;
    deps.health.isStopped.mockImplementation(() => stopped);
    let releasePlan!: () => void;
    const planGate = new Promise<void>((resolve) => { releasePlan = resolve; });
    deps.cognitive.plan = vi.fn(async () => { await planGate; return { plan: { tasks: [] }, source: 'model' }; });
    const restarted = new CapabilityWorkflowService(deps as never);
    const pending = restarted.progress(approval.id);
    await vi.waitFor(() => expect(deps.cognitive.plan).toHaveBeenCalled());
    stopped = true;
    releasePlan();
    await pending;
    await vi.waitFor(async () => { expect((await restarted.progress(approval.id))?.status).toBe('failed'); });
    expect(orchestrator.execute).not.toHaveBeenCalled();
    service.dispose();
    restarted.dispose();
  });
});
