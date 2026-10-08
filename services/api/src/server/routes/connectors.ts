import type { FastifyInstance } from 'fastify';
import type { ConnectorService } from '../../connectors/service.js';
import type { PermissionEngine } from '../../security/permissions.js';
import type { ApprovalService } from '../../security/approvals.js';
import type { Audit } from '../../security/audit.js';
import { maskSecrets } from '../../core/logger.js';

export function registerConnectorRoutes(
  app: FastifyInstance,
  deps: {
    connectors: ConnectorService;
    permissions?: PermissionEngine;
    approvals?: ApprovalService;
    audit?: Audit;
  }
) {
  // GET /api/v1/connectors
  app.get('/api/v1/connectors', async () => {
    const list = await deps.connectors.list();
    return { connectors: list, planned: deps.connectors.getPlanned() };
  });

  // GET /api/v1/connectors/:id
  app.get('/api/v1/connectors/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const c = await deps.connectors.get(p.id);
    if (!c) return reply.status(404).send({ error: 'Connector not found' });
    return c;
  });

  // PUT /api/v1/connectors/:id/config
  app.put('/api/v1/connectors/:id/config', async (req) => {
    const p = req.params as { id: string };
    const body = (req.body as Record<string, string>) ?? {};
    await deps.connectors.setConfig(p.id, body);
    const updated = await deps.connectors.get(p.id);
    return { ok: true, connector: updated };
  });

  // POST /api/v1/connectors/:id/test
  app.post('/api/v1/connectors/:id/test', async (req, reply) => {
    const p = req.params as { id: string };
    const permission = deps.permissions?.evaluate({ permission: 'network.http', resource: `${p.id}:test` });
    if (permission?.decision === 'deny') return reply.status(403).send({ error: permission.reason });
    if (permission?.decision === 'require_approval') return reply.status(403).send({ error: 'Connector test requires approval under the current policy' });
    const res = await deps.connectors.test(p.id);
    return res;
  });

  // POST /api/v1/connectors/:id/actions/:action
  app.post('/api/v1/connectors/:id/actions/:action', async (req, reply) => {
    const p = req.params as { id: string; action: string };
    const body = (req.body as Record<string, any>) ?? {};
    const agentId = (req.headers['x-agent-id'] as string) || (body.agent_id as string) || null;

    const runtime = deps.connectors.getRuntime(p.id);
    if (!runtime) return reply.status(404).send({ error: `Unknown connector: ${p.id}` });
    const actionDef = runtime.manifest.actions.find((a) => a.id === p.action);
    if (!actionDef) return reply.status(404).send({ error: `Unknown action: ${p.action} on connector ${p.id}` });

    const risk = actionDef.risk ?? 'medium';

    // 1. Evaluate permissions if engine available
    if (deps.permissions) {
      const checks = [...new Set(['connector.use', ...runtime.manifest.permissions])].map((permission) => deps.permissions!.evaluate({
        permission: permission as Parameters<PermissionEngine['evaluate']>[0]['permission'],
        agent_id: agentId,
        resource: `${p.id}:${p.action}`,
      }));
      const denied = checks.find((check) => check.decision === 'deny');
      if (denied) return reply.status(403).send({ error: denied.reason });

      // If high or critical risk, or decision is require_approval -> route through approval gate
      if (checks.some((check) => check.decision === 'require_approval') || risk === 'high' || risk === 'critical') {
        if (!deps.approvals) {
          return reply.status(403).send({ error: `Action requires approval but ApprovalService is not configured` });
        }
        const appReq = deps.approvals.request({
          workspace_id: 'default',
          agent_id: agentId,
          action: `connector:${p.id}:${p.action}`,
          target: p.id,
          why: `Execute connector action ${p.action} (risk: ${risk})`,
          tools: [`connector:${p.id}`],
          resources_affected: [`${p.id}:${p.action}`],
          risks: [`Connector action rated ${risk}`],
          rollback_available: false,
          permission: 'connector.use',
          risk,
          payload: body,
        });

        // Wait for human decision
        const decision = await deps.approvals.waitFor(appReq.id, 60000);
        if (decision.status !== 'approved') {
          return reply.status(403).send({ error: `Action rejected: ${decision.status}` });
        }
      }
    }

    try {
      const rawResult = await deps.connectors.execute(p.id, p.action, body);

      // Audit log the execution
      deps.audit?.log({
        actor: agentId ? `agent:${agentId}` : 'user:api',
        agent_id: agentId,
        action: `connector.execute:${p.id}:${p.action}`,
        permission: 'connector.use',
        resource: `${p.id}:${p.action}`,
        decision: 'executed',
        details: { risk },
      });

      // Mask sensitive outputs before returning
      const serialized = JSON.stringify(rawResult);
      const masked = maskSecrets(serialized);
      let safeResult: any;
      try {
        safeResult = JSON.parse(masked);
      } catch {
        safeResult = masked;
      }

      return { ok: true, result: safeResult };
    } catch (err: any) {
      deps.audit?.log({
        actor: agentId ? `agent:${agentId}` : 'user:api',
        agent_id: agentId,
        action: `connector.execute:${p.id}:${p.action}`,
        permission: 'connector.use',
        resource: `${p.id}:${p.action}`,
        decision: 'failed',
        details: { error: err.message },
      });
      return reply.status(500).send({ error: err.message });
    }
  });
}
