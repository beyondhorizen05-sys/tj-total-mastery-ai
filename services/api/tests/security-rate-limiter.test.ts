import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { RateLimiter, createRateLimitHook } from '../src/security/rate-limiter.js';
import { Database } from '../src/db/database.js';
import { EventBus } from '../src/core/event-bus.js';
import { Audit } from '../src/security/audit.js';
import { SettingsRepo } from '../src/db/repo.js';
import { PermissionEngine } from '../src/security/permissions.js';
import { ApprovalService } from '../src/security/approvals.js';
import { Sandbox } from '../src/tools/sandbox.js';
import { registerSecurityRoutes } from '../src/server/routes/security.js';

describe('Security Hardening & Rate Limiter (@api-security-best-practices)', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ cleanupIntervalMs: 10_000 });
  });

  afterEach(() => {
    limiter.destroy();
  });

  describe('Sliding-Window RateLimiter Core', () => {
    it('allows requests within the configured threshold', () => {
      const res1 = limiter.check('client-1', 3, 1000);
      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);

      const res2 = limiter.check('client-1', 3, 1000);
      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = limiter.check('client-1', 3, 1000);
      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);
    });

    it('throttles requests that exceed the limit with 429 metrics', () => {
      // Consume allowance
      limiter.check('client-blocked', 2, 2000);
      limiter.check('client-blocked', 2, 2000);

      // Third request must be denied
      const denied = limiter.check('client-blocked', 2, 2000);
      expect(denied.allowed).toBe(false);
      expect(denied.remaining).toBe(0);
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.resetMs).toBeGreaterThan(0);
    });

    it('isolates different client identifiers into separate buckets', () => {
      limiter.check('user-A', 1, 1000);
      const deniedA = limiter.check('user-A', 1, 1000);
      expect(deniedA.allowed).toBe(false);

      // user-B should still be permitted
      const allowedB = limiter.check('user-B', 1, 1000);
      expect(allowedB.allowed).toBe(true);
    });

    it('allows resetting a client key', () => {
      limiter.check('user-reset', 1, 5000);
      expect(limiter.check('user-reset', 1, 5000).allowed).toBe(false);

      limiter.reset('user-reset');
      expect(limiter.check('user-reset', 1, 5000).allowed).toBe(true);
    });
  });

  describe('Fastify Security Integration & Route Throttling', () => {
    it('attaches rate limit headers and blocks abusive requests with 429', async () => {
      const app = Fastify();
      const hook = createRateLimitHook({
        limiter,
        limit: 2,
        windowMs: 5000,
        errorMessage: 'Custom limit exceeded',
      });

      app.get('/api/v1/test-throttled', { preHandler: hook }, async () => ({ ok: true }));

      // Request 1: allowed
      const res1 = await app.inject({ method: 'GET', url: '/api/v1/test-throttled' });
      expect(res1.statusCode).toBe(200);
      expect(res1.headers['x-ratelimit-limit']).toBe('2');
      expect(res1.headers['x-ratelimit-remaining']).toBe('1');

      // Request 2: allowed
      const res2 = await app.inject({ method: 'GET', url: '/api/v1/test-throttled' });
      expect(res2.statusCode).toBe(200);
      expect(res2.headers['x-ratelimit-remaining']).toBe('0');

      // Request 3: blocked with 429
      const res3 = await app.inject({ method: 'GET', url: '/api/v1/test-throttled' });
      expect(res3.statusCode).toBe(429);
      expect(res3.headers['retry-after']).toBeDefined();
      expect(res3.json().error).toContain('Custom limit exceeded');

      await app.close();
    });

    it('enforces rate limits on sensitive approval routes with security headers', async () => {
      const db = new Database(':memory:');
      db.migrate();
      const bus = new EventBus(db);
      const audit = new Audit(db);
      const settings = new SettingsRepo(db);
      const permissions = new PermissionEngine(db, audit, settings);
      const approvals = new ApprovalService(db, bus, audit, permissions);
      const sandbox = new Sandbox(() => ['C:/dummy']);

      const app = Fastify();

      // Attach strict security headers hook
      app.addHook('onSend', async (_request, reply) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('X-Frame-Options', 'DENY');
        reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
      });

      registerSecurityRoutes(app, {
        approvals,
        permissions,
        settings,
        sandbox,
        audit,
        rateLimiter: limiter,
      });

      const getRes = await app.inject({ method: 'GET', url: '/api/v1/approvals' });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.headers['x-content-type-options']).toBe('nosniff');
      expect(getRes.headers['x-frame-options']).toBe('DENY');
      expect(getRes.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');

      await app.close();
      db.close();
    });
  });
});
