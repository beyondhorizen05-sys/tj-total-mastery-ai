import type { FastifyInstance } from 'fastify';
import { CreateTaskRequest } from '@tj/schemas';
import type { TaskService } from '../../tasks/service.js';
import type { Database } from '../../db/database.js';

export function registerTaskRoutes(
  app: FastifyInstance,
  deps: {
    tasks: TaskService;
    db: Database;
  }
) {
  // GET /api/v1/tasks
  app.get('/api/v1/tasks', async (req) => {
    const q = req.query as { project_id?: string; agent_id?: string; status?: string; limit?: string };
    return { tasks: deps.tasks.list({ project_id: q.project_id, agent_id: q.agent_id, status: q.status, limit: Number(q.limit ?? 100) }) };
  });

  // GET /api/v1/tasks/:id
  app.get('/api/v1/tasks/:id', async (req, reply) => {
    const p = req.params as { id: string };
    const task = deps.tasks.get(p.id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task;
  });

  // POST /api/v1/tasks
  app.post('/api/v1/tasks', async (req) => {
    const body = CreateTaskRequest.parse(req.body);
    const task = deps.tasks.create({
      workspace_id: 'default',
      ...body,
    });
    return task;
  });

  // PATCH /api/v1/tasks/:id
  app.patch('/api/v1/tasks/:id', async (req) => {
    const p = req.params as { id: string };
    const body = (req.body as any) ?? {};
    if (body.status) {
      deps.tasks.setStatus(p.id, body.status, {
        progress: body.progress,
        error: body.error,
        result: body.result,
        agent_id: body.agent_id,
      });
    } else if (body.progress !== undefined) {
      deps.tasks.progress(p.id, body.progress);
    }
    return deps.tasks.get(p.id);
  });

  // DELETE /api/v1/tasks/:id
  app.delete('/api/v1/tasks/:id', async (req) => {
    const p = req.params as { id: string };
    deps.db.run('DELETE FROM tasks WHERE id = ?', [p.id]);
    return { ok: true };
  });
}
