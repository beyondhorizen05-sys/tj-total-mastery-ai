import type { FastifyInstance } from 'fastify';
import { ApprovalDecisionRequest, PolicyRule } from '@tj/schemas';
import type { ApprovalService } from '../../security/approvals.js';
import type { PermissionEngine } from '../../security/permissions.js';
import type { SettingsRepo } from '../../db/repo.js';
import type { Sandbox } from '../../tools/sandbox.js';
import type { Audit } from '../../security/audit.js';
import type { RateLimiter } from '../../security/rate-limiter.js';
import { createRateLimitHook } from '../../security/rate-limiter.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerSecurityRoutes(
  app: FastifyInstance,
  deps: {
    approvals: ApprovalService;
    permissions: PermissionEngine;
    settings: SettingsRepo;
    sandbox: Sandbox;
    audit: Audit;
    rateLimiter?: RateLimiter;
  }
) {
  const normalize = (value: string) => path.resolve(value).replace(/[\\/]+$/, '').replace(/\\/g, '/').toLocaleLowerCase();
  const readAllowedRoots = () => {
    const value = deps.settings.get<unknown>('allowed_roots', []);
    return Array.isArray(value) ? value.filter((root): root is string => typeof root === 'string') : [];
  };

  const allowedRootsThrottle = deps.rateLimiter
    ? createRateLimitHook({
        limiter: deps.rateLimiter,
        limit: 20,
        windowMs: 60_000,
        errorMessage: 'Allowed roots update rate limit exceeded. Please wait a minute.',
      })
    : undefined;

  const approvalThrottle = deps.rateLimiter
    ? createRateLimitHook({
        limiter: deps.rateLimiter,
        limit: 30,
        windowMs: 60_000,
        errorMessage: 'Approval decision rate limit exceeded. Please wait a minute.',
      })
    : undefined;

  app.get('/api/v1/security/allowed-roots', async () => ({ roots: readAllowedRoots() }));

  app.post('/api/v1/security/allowed-roots', allowedRootsThrottle ? { preHandler: allowedRootsThrottle } : {}, async (req, reply) => {
    const parsed = (req.body as { path?: unknown } | null)?.path;
    if (typeof parsed !== 'string' || !parsed.trim() || parsed.length > 2048 || parsed.includes('\0')) {
      return reply.status(400).send({ error: 'Provide an absolute folder path (maximum 2048 characters).' });
    }
    if (!path.isAbsolute(parsed.trim())) return reply.status(400).send({ error: 'Folder path must be absolute.' });

    let canonical: string;
    try {
      canonical = fs.realpathSync(path.resolve(parsed.trim()));
      if (!fs.statSync(canonical).isDirectory()) return reply.status(400).send({ error: 'Allowed root must be an existing folder.' });
    } catch {
      return reply.status(400).send({ error: 'Folder does not exist or cannot be accessed.' });
    }
    if (path.parse(canonical).root === canonical || deps.sandbox.isForbidden(canonical)) {
      return reply.status(400).send({ error: 'Choose a specific, non-system folder. Filesystem and protected system roots cannot be added.' });
    }

    const roots = readAllowedRoots();
    if (roots.some((root) => normalize(root) === normalize(canonical))) return reply.status(409).send({ error: 'This folder is already an allowed root.', roots });
    if (roots.length >= 30) return reply.status(409).send({ error: 'You can add up to 30 extra folders.' });
    roots.push(canonical);
    deps.settings.set('allowed_roots', roots);
    deps.audit.log({ actor: 'user', action: 'filesystem.root.add', permission: 'filesystem.read', resource: canonical, decision: 'allowed', details: { root_count: roots.length } });
    return reply.status(201).send({ ok: true, roots });
  });

  app.delete('/api/v1/security/allowed-roots', async (req, reply) => {
    const requested = (req.query as { path?: string }).path;
    if (!requested || requested.length > 2048 || requested.includes('\0')) return reply.status(400).send({ error: 'Provide the absolute folder path to remove.' });
    const roots = readAllowedRoots();
    const index = roots.findIndex((root) => normalize(root) === normalize(requested));
    if (index < 0) return reply.status(404).send({ error: 'Allowed folder not found.', roots });
    const [removed] = roots.splice(index, 1);
    deps.settings.set('allowed_roots', roots);
    deps.audit.log({ actor: 'user', action: 'filesystem.root.remove', permission: 'filesystem.read', resource: removed, decision: 'removed', details: { root_count: roots.length } });
    return { ok: true, roots };
  });

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
  app.post('/api/v1/approvals/:id/decide', approvalThrottle ? { preHandler: approvalThrottle } : {}, async (req) => {
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
  app.post('/api/v1/policies', async (req, reply) => {
    const schema = PolicyRule.omit({ id: true, created_at: true });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid permission policy.', issues: parsed.error.issues });
    }
    if (parsed.data.expires_at && !Number.isFinite(Date.parse(parsed.data.expires_at))) {
      return reply.status(400).send({ error: 'Policy expiry must be a valid date-time.' });
    }
    const pol = deps.permissions.addPolicy(parsed.data);
    return pol;
  });

  // DELETE /api/v1/policies/:id
  app.delete('/api/v1/policies/:id', async (req) => {
    const p = req.params as { id: string };
    deps.permissions.removePolicy(p.id);
    return { ok: true };
  });
}
