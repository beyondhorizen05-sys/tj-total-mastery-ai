import type { FastifyInstance } from 'fastify';
import { analyzeCsv, CsvAnalysisError, CSV_LIMITS } from '../../data/csv-analysis.js';

/** Explicit, local-only CSV analysis. Uploaded contents are never persisted or sent to a model. */
export function registerDataRoutes(app: FastifyInstance) {
  app.post('/api/v1/data/analyze/csv', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.csv !== 'string') {
      return reply.code(400).send({ error: 'Upload CSV text in the csv field.' });
    }
    if (Buffer.byteLength(body.csv, 'utf8') > CSV_LIMITS.maxBytes) {
      return reply.code(413).send({ error: 'CSV exceeds the 1 MB upload limit.' });
    }
    if (body.filename !== undefined && (typeof body.filename !== 'string' || !/^[^\\/\r\n\0]{1,120}\.csv$/i.test(body.filename))) {
      return reply.code(400).send({ error: 'Filename must be a .csv name without a path.' });
    }
    try {
      return { analysis: analyzeCsv(body.csv, (body.filename as string | undefined) ?? 'uploaded.csv') };
    } catch (error) {
      if (error instanceof CsvAnalysisError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });
}
