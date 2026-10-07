import type { FastifyInstance } from 'fastify';
import { ApprovalDecisionRequest } from '@tj/schemas';
import type { ApprovalService } from '../../security/approvals.js';
import type { PermissionEngine } from '../../security/permissions.js';

export function registerSecurityRoutes(
  app: FastifyInstance,
  deps: {
    approvals: ApprovalService;
    permissions: PermissionEngine;
  }
) {
  // GET /api/v1/approvals
  app.get('/api/v1/approvals', async (req) => {
    const q = req.query as { status?: string };
    return { approvals: deps.approvals.list(q.status) };
  });

  // GET /api/v1/approvals/:id
  app.get('/api/v1/approvals/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const a = deps.approvals.get(p.id);
    if (!a) return reply.status(404).send({ error: 'Approval not found' });
    return a;
  });

  // POST /api/v1/approvals/:id/decide
  app.post('/api/v1/approvals/:id/decide', async (req) => {
    const p = req.params as { id: string };
    const body = ApprovalDecisionRequest.parse(req.body);
    const decided = deps.approvals.decide(
      p.id,
      body.decision,
      'user',
      body.edited_payload as any
    );
    return decided;
  });

  // GET /api/v1/policies
  app.get('/api/v1/policies', async () => {
    return { policies: deps.permissions.listPolicies() };
  });

  // POST /api/v1/policies
  app.post('/api/v1/policies', async (req) => {
    const body = (req.body as any) ?? {};
    const pol = deps.permissions.addPolicy(body);
    return pol;
  });

  // DELETE /api/v1/policies/:id
  app.delete('/api/v1/policies/:id', async (req) => {
    const p = req.params as { id: string };
    deps.permissions.removePolicy(p.id);
    return { ok: true };
  });
}
