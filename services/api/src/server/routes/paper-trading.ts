import type { FastifyInstance } from 'fastify';
import { PaperError, type PaperTradingService } from '../../trading/paper-service.js';

function fail(reply: any, error: unknown) {
  return reply.status(error instanceof PaperError ? error.status : 500).send({ error: (error as Error).message });
}

export function registerPaperTradingRoutes(app: FastifyInstance, deps: { paper: PaperTradingService }) {
  app.get('/api/v1/paper/status', async () => ({ mode: 'historical_paper_only', live_orders_available: false, broker_connected: false, settings: deps.paper.settings() }));
  app.put('/api/v1/paper/settings', async (req, reply) => {
    try { return { settings: deps.paper.updateSettings(req.body) }; }
    catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/paper/kill', async () => ({ settings: deps.paper.kill() }));
  app.get('/api/v1/paper/datasets', async () => ({ datasets: deps.paper.datasets() }));
  app.post('/api/v1/paper/datasets', async (req, reply) => {
    try { return reply.status(201).send({ dataset: deps.paper.addDataset(req.body) }); }
    catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/paper/datasets/:id', async (req, reply) => {
    try { return deps.paper.datasetPreview((req.params as { id: string }).id); }
    catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/paper/runs', async () => ({ runs: deps.paper.runs() }));
  app.post('/api/v1/paper/runs', async (req, reply) => {
    try { return reply.status(201).send({ run: deps.paper.run(req.body) }); }
    catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/paper/runs/:id', async (req, reply) => {
    const run = deps.paper.getRun((req.params as { id: string }).id);
    return run ? { run } : reply.status(404).send({ error: 'Paper run not found' });
  });
}
