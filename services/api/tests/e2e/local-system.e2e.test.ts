import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer } from '../../src/server/app.js';
import { loadConfig } from '../../src/config.js';

describe('local TJ system over HTTP', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-local-e2e-'));
  let server: Awaited<ReturnType<typeof createServer>>;
  let baseUrl: string;
  let activeActivityAbort: AbortController | null = null;

  beforeAll(async () => {
    server = await createServer(loadConfig({
      dataDir,
      dbPath: path.join(dataDir, 'tj.sqlite'),
      vaultPath: path.join(dataDir, 'vault'),
      artifactsDir: path.join(dataDir, 'artifacts'),
      projectsDir: path.join(dataDir, 'projects'),
      backupsDir: path.join(dataDir, 'backups'),
      logsDir: path.join(dataDir, 'logs'),
      enableTestProvider: true,
      enableChatGPTPlanSignIn: false,
    }));
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = server.app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    activeActivityAbort?.abort();
    vi.unstubAllGlobals();
    if (server) {
      await server.app.close();
      server.db.close();
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists agents and tasks through the live API and returns them in HQ state', async () => {
    const health = await fetch(`${baseUrl}/api/v1/system/status`);
    expect(health.status).toBe(200);
    expect((await health.json()).version).toBe('2.0.0');

    const agentResponse = await fetch(`${baseUrl}/api/v1/agents`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Developer', role: 'developer', town_area: 'dev_studio' }),
    });
    expect(agentResponse.status).toBe(200);
    const agent = await agentResponse.json() as { id: string; name: string };

    const taskResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'E2E acceptance task', description: 'Verify local persistence', agent_id: agent.id }),
    });
    expect(taskResponse.status).toBe(200);
    const task = await taskResponse.json() as { id: string; agent_id: string; status: string };
    expect(task.agent_id).toBe(agent.id);

    const progressResponse = await fetch(`${baseUrl}/api/v1/tasks/${task.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ progress: 0.25 }),
    });
    expect(progressResponse.status).toBe(200);
    expect((await progressResponse.json()).progress).toBe(0.25);

    const [agentsResponse, tasksResponse, townResponse] = await Promise.all([
      fetch(`${baseUrl}/api/v1/agents`),
      fetch(`${baseUrl}/api/v1/tasks`),
      fetch(`${baseUrl}/api/v1/town/state`),
    ]);
    const agents = (await agentsResponse.json() as { agents: Array<{ id: string; name: string }> }).agents;
    const tasks = (await tasksResponse.json() as { tasks: Array<{ id: string; progress: number }> }).tasks;
    const town = (await townResponse.json() as { agents: Array<{ id: string; name: string; area: string }> }).agents;
    expect(agents).toContainEqual(expect.objectContaining({ id: agent.id, name: 'E2E Developer' }));
    expect(tasks).toContainEqual(expect.objectContaining({ id: task.id, progress: 0.25 }));
    expect(town).toContainEqual(expect.objectContaining({ id: agent.id, name: 'E2E Developer', area: 'dev_studio' }));
  });

  it('runs the research-build-test-artifact path through chat, Orchestrator, tools, and a configured test model', async () => {
    const provider = await fetch(`${baseUrl}/api/v1/models/providers`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acceptance Test Provider', kind: 'test' }),
    });
    expect(provider.status).toBe(200);
    const providerId = (await provider.json() as { id: string }).id;
    const modelId = `${providerId}/tj-test-echo`;
    const refresh = await fetch(`${baseUrl}/api/v1/models/providers/${providerId}/refresh`, { method: 'POST' });
    expect(refresh.status).toBe(200);
    expect((await refresh.json() as { models: Array<{ id: string }> }).models.map((model) => model.id)).toContain(modelId);
    const settings = await fetch(`${baseUrl}/api/v1/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ default_model_id: modelId, routing_mode: 'manual', autonomy_level: 4 }),
    });
    expect(settings.status).toBe(200);
    const connector = await fetch(`${baseUrl}/api/v1/connectors/tavily/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ api_key: 'e2e-only-tavily-key' }),
    });
    expect(connector.status).toBe(200);
    expect(await connector.text()).not.toContain('e2e-only-tavily-key');

    const externalCalls: Array<{ url: string; query: string }> = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://api.tavily.com/search') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer e2e-only-tavily-key');
        const body = JSON.parse(String(init?.body ?? '{}')) as { query: string };
        externalCalls.push({ url, query: body.query });
        return new Response(JSON.stringify({ results: [
          { title: 'Local-first architecture', url: 'https://example.test/local-first', content: 'Local-first apps keep data on the user device and support offline use, with synchronization complexity as a trade-off.' },
          { title: 'Client-server relational architecture', url: 'https://example.test/client-server', content: 'A client-server app centralizes relational data and simplifies shared access, but needs a running service and database.' },
          { title: 'Event-sourced architecture', url: 'https://example.test/event-sourced', content: 'Event sourcing stores an append-only history that supports audit and reconstruction, at higher implementation complexity.' },
        ] }), { status: 200 });
      }
      return realFetch(input, init);
    });

    // ActivityView consumes these same persisted events and the SSE stream.
    const activityAbort = activeActivityAbort = new AbortController();
    const activityResponse = await fetch(`${baseUrl}/api/v1/system/events`, { signal: activityAbort.signal });
    expect(activityResponse.status).toBe(200);
    expect(activityResponse.headers.get('content-type')).toContain('text/event-stream');
    const activityReader = activityResponse.body!.getReader();
    const liveActivityNames: string[] = [];
    const collectLiveActivity = (async () => {
      const decoder = new TextDecoder();
      let pending = '';
      try {
        while (true) {
          const { done, value } = await activityReader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let boundary = pending.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const eventName = frame.match(/^event: ([^\r\n]+)/m)?.[1];
            if (eventName && eventName !== 'ping') liveActivityNames.push(eventName);
            boundary = pending.indexOf('\n\n');
          }
        }
      } catch { /* abort after the workflow completes */ }
    })();

    const chatRequest = fetch(`${baseUrl}/api/v1/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'build',
        content: 'TJ_ACCEPTANCE_E2E_RESEARCH_BUILD_TEST: Research three good approaches for a personal project management app, decide the strongest architecture, create a team to build a small working prototype, test it and give me the result. Save research evidence, project files, test logs, and a concise project memory.',
      }),
    });
    const waitForToolApproval = async (toolId: string) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        const pendingResponse = await fetch(`${baseUrl}/api/v1/approvals?status=pending`);
        const pending = (await pendingResponse.json() as { approvals: Array<{ id: string; target: string; tools: string[] }> }).approvals;
        const approval = pending.find((item) => item.tools.includes(toolId));
        if (approval) return approval;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`The E2E request did not ask for the expected ${toolId} approval.`);
    };
    const approveOnce = async (toolId: string) => {
      const approval = await waitForToolApproval(toolId);
      const response = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/decide`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
      });
      expect(response.status).toBe(200);
      return approval;
    };
    const searchApproval = await approveOnce('web_search');
    expect(searchApproval.target).toBe('Tavily or Brave Search');
    const response = await chatRequest;
    expect(response.status).toBe(200);
    const result = await response.json() as {
      status: string;
      plan_id: string;
      evidence: { changed_files: string[]; source_calls: number; test_calls: number; gaps: string[] };
      artifacts: Array<{ name: string; path?: string }>;
    };
    expect(result.status).toBe('completed');
    expect(result.plan_id).toBeTruthy();
    const persistedProject = server.db.get<{ project_id: string }>('SELECT project_id FROM plans WHERE id = ?', [result.plan_id]);
    expect(persistedProject?.project_id).toBeTruthy();
    const isolatedProject = server.db.get<{ root_path: string }>('SELECT root_path FROM projects WHERE id = ?', [persistedProject!.project_id]);
    expect(path.resolve(isolatedProject!.root_path)).toBe(path.resolve(dataDir, 'projects', path.basename(isolatedProject!.root_path)));
    expect(path.resolve(isolatedProject!.root_path)).not.toBe(path.resolve(process.cwd()));
    expect(result.evidence).toMatchObject({ source_calls: 1, test_calls: 1, gaps: [] });
    expect(result.evidence.changed_files).toEqual(expect.arrayContaining(['package.json', 'tracker.mjs', 'index.mjs', 'tracker.test.mjs']));
    expect(result.artifacts.map((artifact) => artifact.name)).toEqual(expect.arrayContaining(['package.json', 'tracker.mjs', 'index.mjs', 'tracker.test.mjs']));
    const projectId = persistedProject!.project_id;
    const tasksResponse = await fetch(`${baseUrl}/api/v1/tasks?project_id=${encodeURIComponent(projectId)}`);
    const tasks = (await tasksResponse.json() as { tasks: Array<{ title: string; status: string; result: { output?: string } | null }> }).tasks;
    expect(tasks).toHaveLength(7);
    expect(tasks.every((task) => task.status === 'completed')).toBe(true);
    expect(tasks.find((task) => task.title === 'Test the tracker and smoke-check its commands')?.result?.output).toMatch(/exit_code: 0/);
    expect(externalCalls).toEqual([{ url: 'https://api.tavily.com/search', query: 'Compare local-first JSON, client-server relational database, and event-sourced approaches for a personal project management app' }]);
    const research = server.db.all<{ source_title: string; source_url: string; excerpt: string }>('SELECT source_title, source_url, excerpt FROM research_notes WHERE project_id = ?', [projectId]);
    expect(research).toHaveLength(3);
    expect(research.map((note) => note.source_url)).toEqual(expect.arrayContaining(['https://example.test/local-first', 'https://example.test/client-server', 'https://example.test/event-sourced']));
    for (const artifact of result.artifacts) expect(artifact.path && fs.existsSync(artifact.path)).toBe(true);
    expect(fs.readFileSync(result.artifacts.find((artifact) => artifact.name === 'package.json')!.path!, 'utf8')).toContain('"test": "node --test"');
    expect(fs.readFileSync(result.artifacts.find((artifact) => artifact.name === 'tracker.mjs')!.path!, 'utf8')).toContain('export function createTaskStore');
    expect(server.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM artifacts WHERE project_id = ?', [projectId])?.count).toBeGreaterThanOrEqual(4);
    expect(server.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM memories WHERE project_id = ?', [projectId])?.count).toBeGreaterThan(0);

    const activityHistoryResponse = await fetch(`${baseUrl}/api/v1/system/activity?limit=100`);
    expect(activityHistoryResponse.status).toBe(200);
    const activityHistory = (await activityHistoryResponse.json() as { events: Array<{ name: string; project_id: string | null }> }).events;
    const visibleEvents = activityHistory.filter((event) => event.project_id === projectId);
    const visibleEventNames = new Set(visibleEvents.map((event) => event.name));
    activityAbort.abort();
    await collectLiveActivity;
    activeActivityAbort = null;
    for (const name of ['task.completed', 'tool.called', 'tool.completed', 'artifact.created']) {
      expect(visibleEventNames, `ActivityView recent history should include ${name}`).toContain(name);
    }
    for (const name of ['task.created', 'task.completed', 'tool.called', 'artifact.created']) {
      expect(liveActivityNames, `ActivityView SSE should receive ${name}`).toContain(name);
    }
  });

  it('holds a worker sensitive action until approval and records approval or denial', async () => {
    let executions = 0;
    server.tools.register({
      id: 'e2e.sensitive_message',
      name: 'Send protected message',
      description: 'E2E-only action used to verify the high-risk approval gate.',
      domain: 'communications',
      input_schema: { type: 'object', properties: { recipient: { type: 'string' } }, required: ['recipient'] },
      permission: 'email.send',
      risk: 'high',
      reversible: false,
      resource: (args) => `email:${args.recipient}`,
      describe: (args) => ({ action: 'Send protected message', target: String(args.recipient), why: 'Verify approval gating.', risks: ['External communication'] }),
      execute: async () => { executions++; return { ok: true, output: 'test action executed' }; },
    });
    const agentResponse = await fetch(`${baseUrl}/api/v1/agents`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Worker', role: 'assistant', permissions: ['email.send'] }),
    });
    expect(agentResponse.status).toBe(200);
    const agent = await agentResponse.json() as { id: string };
    const context = { workspace_id: 'default', project_id: null, project_root: null, agent_id: agent.id, agent_permissions: ['email.send'], task_id: null, workflow_run_id: null };
    const act = (recipient: string) => server.tools.execute('e2e.sensitive_message', { recipient }, context);
    const waitForPending = async () => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const response = await fetch(`${baseUrl}/api/v1/approvals?status=pending`);
        const body = await response.json() as { approvals: Array<{ id: string; agent_id: string; target: string; risk: string; status: string }> };
        const approval = body.approvals[0];
        if (approval) return approval;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error('Worker did not request approval');
    };

    const approvedExecution = act('qa-approved@example.invalid');
    const approval = await waitForPending();
    expect(approval).toMatchObject({ agent_id: agent.id, target: 'qa-approved@example.invalid', risk: 'high', status: 'pending' });
    expect(executions).toBe(0);
    const details = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}`);
    expect(details.status).toBe(200);
    expect((await details.json()).tools).toContain('e2e.sensitive_message');
    const approve = await fetch(`${baseUrl}/api/v1/approvals/${approval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approve.status).toBe(200);
    expect((await approvedExecution).ok).toBe(true);
    expect(executions).toBe(1);

    const deniedExecution = act('qa-denied@example.invalid');
    const deniedResult = expect(deniedExecution).rejects.toThrow(/denied by user/i);
    const deniedApproval = await waitForPending();
    expect(deniedApproval).toMatchObject({ agent_id: agent.id, target: 'qa-denied@example.invalid', status: 'pending' });
    expect(executions).toBe(1);
    const deny = await fetch(`${baseUrl}/api/v1/approvals/${deniedApproval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'deny' }),
    });
    expect(deny.status).toBe(200);
    await deniedResult;
    expect(executions).toBe(1);

    const records = server.db.all<{ action: string; decision: string }>(
      "SELECT action, decision FROM audit_log WHERE action LIKE '%e2e.sensitive_message%' OR action LIKE 'approval.%:Send protected message'",
    );
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'approval.approved:Send protected message', decision: 'approved' }),
      expect.objectContaining({ action: 'approval.denied:Send protected message', decision: 'denied' }),
      expect.objectContaining({ action: 'tool.execute:e2e.sensitive_message', decision: 'success' }),
    ]));
  });

  it('copies with overwrite backups and moves only after approval, then fully undoes the move from its backup', async () => {
    const autonomy = await fetch(`${baseUrl}/api/v1/settings`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ autonomy_level: 4 }),
    });
    expect(autonomy.status).toBe(200);
    const projectRoot = path.join(dataDir, 'projects', 'file-operations-e2e');
    const targetFolder = path.join(projectRoot, 'archive');
    fs.mkdirSync(targetFolder, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'source.txt'), 'new source content', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'copy.txt'), 'previous destination content', 'utf8');
    const context = { workspace_id: 'default', project_id: null, project_root: projectRoot, agent_id: null, agent_permissions: null, task_id: null, workflow_run_id: null };

    const copyRejected = await server.tools.execute('fs_copy', { path: 'source.txt', destination: 'copy.txt' }, context);
    expect(copyRejected.ok).toBe(false);
    expect(fs.readFileSync(path.join(projectRoot, 'copy.txt'), 'utf8')).toBe('previous destination content');
    const copied = await server.tools.execute('fs_copy', { path: 'source.txt', destination: 'copy.txt', overwrite: true }, context);
    expect(copied.ok).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'copy.txt'), 'utf8')).toBe('new source content');
    const copyBackupId = String(copied.data?.backup_id);
    const copyRestore = server.tools.execute('fs_restore', { backup_id: copyBackupId }, context);
    const waitForApproval = async (action: string) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const response = await fetch(`${baseUrl}/api/v1/approvals?status=pending`);
        const body = await response.json() as { approvals: Array<{ id: string; action: string; status: string }> };
        const approval = body.approvals.find((item) => item.action === action && item.status === 'pending');
        if (approval) return approval;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error(`No pending ${action} approval appeared`);
    };
    const restoreApproval = await waitForApproval('Restore file version');
    expect(fs.readFileSync(path.join(projectRoot, 'copy.txt'), 'utf8')).toBe('new source content');
    const approveRestore = await fetch(`${baseUrl}/api/v1/approvals/${restoreApproval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approveRestore.status).toBe(200);
    expect((await copyRestore).ok).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'copy.txt'), 'utf8')).toBe('previous destination content');

    const move = server.tools.execute('fs_move', { path: 'source.txt', destination: 'archive/source.txt' }, context);
    const moveApproval = await waitForApproval('Move file');
    expect(fs.existsSync(path.join(projectRoot, 'source.txt'))).toBe(true);
    expect(fs.existsSync(path.join(targetFolder, 'source.txt'))).toBe(false);
    const approveMove = await fetch(`${baseUrl}/api/v1/approvals/${moveApproval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approveMove.status).toBe(200);
    const moved = await move;
    expect(moved.ok).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'source.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(targetFolder, 'source.txt'), 'utf8')).toBe('new source content');

    const undo = server.tools.execute('fs_restore', { backup_id: String(moved.data?.source_backup_id) }, context);
    const undoApproval = await waitForApproval('Restore file version');
    const approveUndo = await fetch(`${baseUrl}/api/v1/approvals/${undoApproval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approveUndo.status).toBe(200);
    expect((await undo).ok).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'source.txt'), 'utf8')).toBe('new source content');
    expect(fs.existsSync(path.join(targetFolder, 'source.txt'))).toBe(false);

    fs.writeFileSync(path.join(projectRoot, 'edited-later.txt'), 'original bytes', 'utf8');
    const secondMove = server.tools.execute('fs_move', { path: 'edited-later.txt', destination: 'archive/edited-later.txt' }, context);
    const secondMoveApproval = await waitForApproval('Move file');
    const approveSecondMove = await fetch(`${baseUrl}/api/v1/approvals/${secondMoveApproval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approveSecondMove.status).toBe(200);
    const secondMoved = await secondMove;
    expect(secondMoved.ok).toBe(true);
    fs.writeFileSync(path.join(targetFolder, 'edited-later.txt'), 'new content added after the move', 'utf8');
    const sourceOnlyRestore = server.tools.execute('fs_restore', { backup_id: String(secondMoved.data?.source_backup_id), source_only: true }, context);
    const sourceOnlyApproval = await waitForApproval('Restore file version');
    const approveSourceOnly = await fetch(`${baseUrl}/api/v1/approvals/${sourceOnlyApproval.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approveSourceOnly.status).toBe(200);
    expect((await sourceOnlyRestore).ok).toBe(true);
    expect(fs.readFileSync(path.join(projectRoot, 'edited-later.txt'), 'utf8')).toBe('original bytes');
    expect(fs.readFileSync(path.join(targetFolder, 'edited-later.txt'), 'utf8')).toBe('new content added after the move');
  });

  it('requires a fresh one-time approval after edits and executes only the newly approved connector request', async () => {
    const webhook = 'https://hooks.slack.com/services/TJ/QA/opaque-test-secret';
    const sent: Array<{ url: string; body: string }> = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === webhook) {
        sent.push({ url, body: String(init?.body ?? '') });
        return new Response('ok', { status: 200 });
      }
      return realFetch(input, init);
    });

    const config = await fetch(`${baseUrl}/api/v1/connectors/slack_webhook/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhook_url: webhook }),
    });
    expect(config.status).toBe(200);
    expect(await config.text()).not.toContain(webhook);

    const requestedText = 'Original message requiring approval';
    const actionPromise = fetch(`${baseUrl}/api/v1/connectors/slack_webhook/actions/post`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: requestedText }),
    });
    let approval: { id: string; action: string } | undefined;
    for (let attempt = 0; attempt < 30 && !approval; attempt++) {
      const response = await fetch(`${baseUrl}/api/v1/approvals?status=pending`);
      const body = await response.json() as { approvals: Array<{ id: string; action: string }> };
      approval = body.approvals.find((candidate) => candidate.action === 'connector:slack_webhook:post');
      if (!approval) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(approval).toBeDefined();
    expect(sent).toHaveLength(0);

    const edit = await fetch(`${baseUrl}/api/v1/approvals/${approval!.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'edit', edited_payload: { text: 'Different reviewed text' } }),
    });
    expect(edit.status).toBe(200);
    const action = await actionPromise;
    expect(action.status).toBe(409);
    expect((await action.json()).error).toMatch(/edited.*submit the updated connector action again/i);
    expect(sent).toHaveLength(0);

    const approvedText = 'Fresh request after reviewing the edit';
    const approvedAction = fetch(`${baseUrl}/api/v1/connectors/slack_webhook/actions/post`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: approvedText }),
    });
    let secondApproval: { id: string; action: string } | undefined;
    for (let attempt = 0; attempt < 30 && !secondApproval; attempt++) {
      const response = await fetch(`${baseUrl}/api/v1/approvals?status=pending`);
      const body = await response.json() as { approvals: Array<{ id: string; action: string }> };
      secondApproval = body.approvals.find((candidate) => candidate.action === 'connector:slack_webhook:post');
      if (!secondApproval) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(secondApproval).toBeDefined();
    const approve = await fetch(`${baseUrl}/api/v1/approvals/${secondApproval!.id}/decide`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approve_once' }),
    });
    expect(approve.status).toBe(200);
    expect((await approvedAction).status).toBe(200);
    expect(sent).toEqual([{ url: webhook, body: JSON.stringify({ text: approvedText }) }]);
  });
});
