import type { FastifyInstance } from 'fastify';
import { GraphError, type GraphService } from '../../graph/service.js';

export function registerGraphRoutes(app: FastifyInstance, deps: { graph: GraphService }) {
  app.get('/api/v1/graph', async (req, reply) => {
    try {
      const projectId = (req.query as { project_id?: unknown }).project_id;
      if (projectId !== undefined && (typeof projectId !== 'string' || projectId.length > 100)) throw new GraphError('Invalid project id');
      return deps.graph.build((projectId as string | undefined) || null);
    } catch (error) {
      return reply.status(error instanceof GraphError ? error.status : 500).send({ error: (error as Error).message });
    }
  });
}
