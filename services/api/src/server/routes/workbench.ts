import type { FastifyInstance } from 'fastify';
import type { ApiWorkbench, SavedRequest } from '../../workbench/service.js';
import type { PermissionEngine } from '../../security/permissions.js';
import type { ApprovalService } from '../../security/approvals.js';
import type { Audit } from '../../security/audit.js';

export function registerWorkbenchRoutes(app: FastifyInstance, deps: {
  workbench: ApiWorkbench; permissions: PermissionEngine; approvals: ApprovalService; audit: Audit;
}) {
  app.get('/api/v1/workbench/requests', async () => ({ requests: deps.workbench.list() }));
  app.get('/api/v1/workbench/history', async (req) => {
    const query = req.query as { request_id?: string };
    return { history: deps.workbench.history(query.request_id) };
  });
  app.get('/api/v1/workbench/credentials', async () => ({ credentials: deps.workbench.credentials() }));
  app.post('/api/v1/workbench/credentials', async (req, reply) => {
    try { return reply.status(201).send(deps.workbench.addBearerSecret(req.body as { host: string; label: string; token: string })); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.post('/api/v1/workbench/requests', async (req, reply) => {
    try { return reply.status(201).send(deps.workbench.save(req.body as SavedRequest)); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.put('/api/v1/workbench/requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return deps.workbench.save({ ...(req.body as SavedRequest), id }); }
    catch (error) { return reply.status((error as Error).message === 'Saved request not found' ? 404 : 400).send({ error: (error as Error).message }); }
  });
  app.delete('/api/v1/workbench/requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    return deps.workbench.delete(id) ? { ok: true } : reply.status(404).send({ error: 'Saved request not found' });
  });
  app.post('/api/v1/workbench/requests/:id/run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const saved = deps.workbench.get(id);
    if (!saved) return reply.status(404).send({ error: 'Saved request not found' });
    const host = new URL(saved.url).hostname;
    const policy = deps.permissions.evaluate({ permission: 'network.http', resource: host, actor: 'user:workbench' });
    if (policy.decision === 'deny') return reply.status(403).send({ error: policy.reason });
    const writes = !['GET', 'HEAD'].includes(saved.method);
    if (writes || policy.decision === 'require_approval') {
      const approval = deps.approvals.request({
        workspace_id: 'default', action: `workbench:${saved.method}`, target: host,
        why: `Send ${saved.method} request to ${host}`, tools: ['api_workbench'], resources_affected: [host],
        risks: ['External HTTP request may change remote state'], rollback_available: false,
        permission: 'network.http', risk: writes ? 'high' : 'low', payload: { request_id: id, method: saved.method, host },
      });
      const decision = await deps.approvals.waitFor(approval.id, 60_000);
      if (decision.status !== 'approved' && decision.status !== 'approved_workflow') return reply.status(403).send({ error: `Request ${decision.status}` });
    }
    try {
      const result = await deps.workbench.run(id, saved);
      deps.audit.log({ actor: 'user:workbench', action: 'workbench.execute', permission: 'network.http', resource: host,
        decision: 'executed', details: { method: saved.method, status: result.status, request_id: id } });
      return result;
    } catch (error) {
      deps.audit.log({ actor: 'user:workbench', action: 'workbench.execute', permission: 'network.http', resource: host,
        decision: 'failed', details: { method: saved.method, request_id: id, error: (error as Error).message } });
      const message = (error as Error).message;
      return reply.status(message.startsWith('Saved request changed after approval') ? 409 : 502).send({ error: message });
    }
  });
}
