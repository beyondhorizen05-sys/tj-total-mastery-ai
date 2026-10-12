import type { FastifyInstance } from 'fastify';
import type { Sandbox } from '../../tools/sandbox.js';
import { searchTree } from '../../tools/builtin/fs-helpers.js';
import fs from 'node:fs';

/** Palette search is read-only and limited to folders explicitly trusted by the user. */
export function registerFileSearchRoutes(app: FastifyInstance, deps: { sandbox: Sandbox; allowedRoots: () => string[] }) {
  app.get('/api/v1/files/search', async (req, reply) => {
    const query = (req.query as { query?: unknown }).query;
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) {
      return reply.status(400).send({ error: 'Search query must be 2–100 characters.' });
    }
    const hits: string[] = [];
    for (const root of deps.allowedRoots()) {
      // Reuse fs_search's canonical root guard, including symlink/junction checks.
      if (typeof root !== 'string' || !deps.sandbox.isInside(root) || deps.sandbox.isForbidden(root)) continue;
      try {
        if (deps.sandbox.normalize(fs.realpathSync(root)) !== deps.sandbox.normalize(root) || !fs.statSync(root).isDirectory()) continue;
        hits.push(...searchTree(root, query.trim(), 20));
      } catch { /* missing or unreadable root */ }
      if (hits.length >= 50) break;
    }
    return { results: hits.slice(0, 50), roots_searched: deps.allowedRoots().length };
  });
}
