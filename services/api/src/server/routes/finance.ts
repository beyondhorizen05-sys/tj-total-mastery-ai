import type { FastifyInstance, FastifyReply } from 'fastify';
import { FinanceError, type FinanceService } from '../../finance/service.js';

function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof FinanceError) return reply.code(error.status).send({ error: error.message });
  throw error;
}

export function registerFinanceRoutes(app: FastifyInstance, deps: { finance: FinanceService }) {
  app.get('/api/v1/finance/status', async () => deps.finance.status());
  app.post('/api/v1/finance/currency', async (req, reply) => {
    try { return { currency: deps.finance.setCurrency((req.body as any)?.currency) }; }
    catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/finance/transactions', async (req, reply) => {
    try { return { transactions: deps.finance.listTransactions(Number((req.query as any)?.limit ?? 100)) }; }
    catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/finance/transactions', async (req, reply) => {
    try { return reply.code(201).send({ transaction: deps.finance.addTransaction((req.body ?? {}) as any) }); }
    catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/finance/budgets', async (req, reply) => {
    try { return reply.code(201).send({ budget: deps.finance.addBudget((req.body ?? {}) as any) }); }
    catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/finance/import/csv', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      return reply.code(201).send(deps.finance.importCsv(body.csv, body.filename));
    } catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/finance/summary', async (req, reply) => {
    try { return deps.finance.summary((req.query as any)?.month); }
    catch (error) { return fail(reply, error); }
  });
}
