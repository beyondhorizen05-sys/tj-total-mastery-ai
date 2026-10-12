import type { FastifyInstance } from 'fastify';
import { CreateTaskRequest } from '@tj/schemas';
import type { TaskService } from '../../tasks/service.js';
import type { Orchestrator } from '../../orchestrator/orchestrator.js';

export function registerTaskRoutes(
  app: FastifyInstance,
  deps: {
    tasks: TaskService;
    orchestrator: Orchestrator;
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

  // Pause is cooperative: an in-flight model/tool call finishes, then the task
  // waits before its next action. Queued tasks remain unscheduled while paused.
  app.post('/api/v1/tasks/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const task = deps.tasks.pause(id);
      return task ?? reply.code(404).send({ error: 'Task not found' });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/v1/tasks/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const task = deps.tasks.resume(id);
      return task ?? reply.code(404).send({ error: 'Task not found' });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
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
  app.delete('/api/v1/tasks/:id', async (req, reply) => {
    const p = req.params as { id: string };
    try {
      if (!deps.tasks.delete(p.id)) return reply.code(404).send({ error: 'Task not found' });
      return { ok: true, deleted_id: p.id };
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /api/v1/tasks/:id/recover — bounded diagnosis and repair for a failed/blocked task.
  app.post('/api/v1/tasks/:id/recover', async (req, reply) => {
    const p = req.params as { id: string };
    try {
      return await deps.orchestrator.recoverTask(p.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(message === 'Task not found' ? 404 : 409).send({ error: message });
    }
  });
}
