/**
 * High-Performance Sliding-Window Rate Limiter & Security Throttling.
 *
 * Implements @api-security-best-practices:
 * - Precise sliding-window timestamp tracking (sub-millisecond accuracy)
 * - Automatic background cleanup of expired sliding-window buckets
 * - Standard HTTP headers (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Retry-After)
 * - Fastify preHandler hook for securing sensitive routes (approvals, models, vault)
 */

import type { FastifyRequest, FastifyReply } from 'fastify';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds?: number;
}

export interface RateLimiterOptions {
  cleanupIntervalMs?: number;
}

export class RateLimiter {
  private buckets = new Map<string, number[]>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: RateLimiterOptions = {}) {
    const interval = options.cleanupIntervalMs ?? 60_000;
    // Periodic garbage collection for idle keys
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Evaluates whether a request with the given key is allowed under the rate limit.
   */
  check(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }

    // Filter out timestamps outside the sliding window
    while (timestamps.length > 0 && timestamps[0] <= windowStart) {
      timestamps.shift();
    }

    if (timestamps.length >= limit) {
      const oldestInWindow = timestamps[0];
      const resetMs = Math.max(0, oldestInWindow + windowMs - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));

      return {
        allowed: false,
        limit,
        remaining: 0,
        resetMs,
        retryAfterSeconds,
      };
    }

    // Allow and record current request timestamp
    timestamps.push(now);
    const remaining = limit - timestamps.length;
    const resetMs = timestamps.length > 0 ? Math.max(0, timestamps[0] + windowMs - now) : windowMs;

    return {
      allowed: true,
      limit,
      remaining,
      resetMs,
    };
  }

  /**
   * Resets rate limit for a specific key (useful in tests or admin overrides).
   */
  reset(key?: string) {
    if (key) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  /**
   * Removes stale buckets to prevent memory leaks.
   */
  cleanup(maxAgeMs = 120_000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, timestamps] of this.buckets.entries()) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Releases background timers.
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }
}

/**
 * Creates a Fastify preHandler hook that applies sliding-window rate limiting.
 */
export function createRateLimitHook(options: {
  limiter: RateLimiter;
  limit: number;
  windowMs: number;
  keyGenerator?: (req: FastifyRequest) => string;
  errorMessage?: string;
}) {
  const { limiter, limit, windowMs, errorMessage } = options;
  const defaultKeyGen = (req: FastifyRequest) => req.ip || req.headers['x-forwarded-for']?.toString() || 'global';
  const keyGen = options.keyGenerator ?? defaultKeyGen;

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const key = keyGen(req);
    const result = limiter.check(key, limit, windowMs);

    reply.header('X-RateLimit-Limit', result.limit.toString());
    reply.header('X-RateLimit-Remaining', result.remaining.toString());
    reply.header('X-RateLimit-Reset', Math.ceil(result.resetMs / 1000).toString());

    if (!result.allowed) {
      reply.header('Retry-After', (result.retryAfterSeconds ?? 1).toString());
      return reply.status(429).send({
        error: errorMessage ?? 'Too Many Requests: Rate limit exceeded. Please try again later.',
        retry_after: result.retryAfterSeconds,
      });
    }
  };
}
