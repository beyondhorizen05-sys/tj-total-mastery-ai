import type { FastifyInstance } from 'fastify';
import type { MediaLibrary, MediaItem, MediaProject } from '../../media/service.js';

export function registerMediaRoutes(app: FastifyInstance, deps: { media: MediaLibrary }) {
  const media = deps.media;
  app.get('/api/v1/media/items', async (req, reply) => {
    try { return { items: media.listItems(req.query as { q?: string; type?: string; status?: string }) }; }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.post('/api/v1/media/items', async (req, reply) => {
    try { return reply.status(201).send(media.saveItem(req.body as MediaItem)); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.put('/api/v1/media/items/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return media.saveItem({ ...(req.body as MediaItem), id }); }
    catch (error) { return reply.status((error as Error).message === 'Media item not found' ? 404 : 400).send({ error: (error as Error).message }); }
  });
  app.delete('/api/v1/media/items/:id', async (req, reply) => media.deleteItem((req.params as { id: string }).id) ? { ok: true } : reply.status(404).send({ error: 'Media item not found' }));

  app.get('/api/v1/media/collections', async () => ({ collections: media.collections() }));
  app.post('/api/v1/media/collections', async (req, reply) => {
    try { return reply.status(201).send(media.createCollection(req.body as { name: string; description?: string })); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.get('/api/v1/media/collections/:id/items', async (req, reply) => {
    try { return { items: media.collectionItems((req.params as { id: string }).id) }; }
    catch (error) { return reply.status(404).send({ error: (error as Error).message }); }
  });
  app.post('/api/v1/media/collections/:id/items/:itemId', async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    try { media.addToCollection(id, itemId); return { ok: true }; }
    catch (error) { return reply.status(404).send({ error: (error as Error).message }); }
  });
  app.delete('/api/v1/media/collections/:id/items/:itemId', async (req, reply) => {
    const { id, itemId } = req.params as { id: string; itemId: string };
    return media.removeFromCollection(id, itemId) ? { ok: true } : reply.status(404).send({ error: 'Collection membership not found' });
  });

  app.get('/api/v1/media/projects', async () => ({ projects: media.projects() }));
  app.post('/api/v1/media/projects', async (req, reply) => {
    try { return reply.status(201).send(media.saveProject(req.body as MediaProject)); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.put('/api/v1/media/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return media.saveProject({ ...(req.body as MediaProject), id }); }
    catch (error) { return reply.status((error as Error).message === 'Creative project not found' ? 404 : 400).send({ error: (error as Error).message }); }
  });

  app.get('/api/v1/media/assets', async (req) => ({ assets: media.assets((req.query as { project_id?: string }).project_id) }));
  app.post('/api/v1/media/assets', async (req, reply) => {
    try { return reply.status(201).send(media.importAsset(req.body as { filename: string; mime_type: string; base64: string; project_id?: string | null })); }
    catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
  });
  app.get('/api/v1/media/assets/:id/content', async (req, reply) => {
    const result = media.assetContent((req.params as { id: string }).id);
    if (!result) return reply.status(404).send({ error: 'Asset not found' });
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', 'sandbox');
    reply.header('Accept-Ranges', 'bytes');
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const size = result.bytes.length;
      const suffix = !range[1] && range[2] ? Number(range[2]) : null;
      const start = suffix === null ? Number(range[1]) : Math.max(0, size - suffix);
      const requestedEnd = range[2] && suffix === null ? Number(range[2]) : size - 1;
      const end = Math.min(requestedEnd, size - 1);
      if ((!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
        || (suffix !== null && (!Number.isSafeInteger(suffix) || suffix === 0)) || start > end) {
        return reply.status(416).header('Content-Range', `bytes */${result.bytes.length}`).send();
      }
      return reply.status(206).type(result.asset.mime_type).header('Content-Range', `bytes ${start}-${end}/${size}`).send(result.bytes.subarray(start, end + 1));
    }
    return reply.type(result.asset.mime_type).send(result.bytes);
  });
  app.delete('/api/v1/media/assets/:id', async (req, reply) => media.deleteAsset((req.params as { id: string }).id) ? { ok: true } : reply.status(404).send({ error: 'Asset not found' }));
}
