import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { Database } from '../src/db/database.js';
import { MediaLibrary } from '../src/media/service.js';
import { registerMediaRoutes } from '../src/server/routes/media.js';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lH0AAAAASUVORK5CYII=';

describe('local media library and creative projects', () => {
  let db: Database;
  let dir: string;
  let media: MediaLibrary;
  beforeEach(() => {
    db = new Database(':memory:'); db.migrate();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tj-media-test-'));
    media = new MediaLibrary(db, dir);
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  it('saves searchable watch/read/listen items and collection membership', () => {
    const book = media.saveItem({ title: 'Future of Design', type: 'book', creator: 'A. Author', notes: 'Read for branding', status: 'planned' });
    const album = media.saveItem({ title: 'Ambient Lines', type: 'music', creator: 'Studio', status: 'in_progress' });
    expect(media.listItems({ q: 'future' }).map((item) => item.id)).toEqual([book.id]);
    expect(media.listItems({ type: 'music' }).map((item) => item.id)).toEqual([album.id]);
    const collection = media.createCollection({ name: 'Inspiration', description: 'Design references' });
    media.addToCollection(collection.id, book.id);
    media.addToCollection(collection.id, book.id);
    expect(media.collections()[0].item_count).toBe(1);
    expect(media.collectionItems(collection.id)[0].title).toBe('Future of Design');
    expect(media.removeFromCollection(collection.id, book.id)).toBe(true);
    expect(media.collectionItems(collection.id)).toHaveLength(0);
    expect(() => media.saveItem({ title: 'x', type: 'unsupported' })).toThrow(/Unsupported media type/);
  });

  it('stores an asset under a generated path and previews verified media bytes', async () => {
    const project = media.saveProject({ title: 'TJ identity', brief: 'Warm future-facing visual identity', status: 'active' });
    const app = Fastify(); registerMediaRoutes(app, { media });
    const imported = await app.inject({ method: 'POST', url: '/api/v1/media/assets', payload: {
      filename: '../../logo.png', mime_type: 'image/png', base64: tinyPng, project_id: project.id,
    } });
    expect(imported.statusCode).toBe(201);
    const asset = imported.json();
    expect(asset).toMatchObject({ filename: 'logo.png', kind: 'image', mime_type: 'image/png', project_id: project.id });
    const storedNames = fs.readdirSync(dir);
    expect(storedNames).toHaveLength(1);
    expect(storedNames[0]).not.toContain('logo');
    const preview = await app.inject({ method: 'GET', url: `/api/v1/media/assets/${asset.id}/content` });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('image/png');
    expect(preview.headers['x-content-type-options']).toBe('nosniff');
    expect(preview.rawPayload.equals(Buffer.from(tinyPng, 'base64'))).toBe(true);
    const partial = await app.inject({ method: 'GET', url: `/api/v1/media/assets/${asset.id}/content`, headers: { range: 'bytes=0-7' } });
    expect(partial.statusCode).toBe(206);
    expect(partial.rawPayload.length).toBe(8);
    const bytes = Buffer.from(tinyPng, 'base64');
    const oversizedEnd = await app.inject({ method: 'GET', url: `/api/v1/media/assets/${asset.id}/content`, headers: { range: 'bytes=8-99999' } });
    expect(oversizedEnd.statusCode).toBe(206);
    expect(oversizedEnd.headers['content-range']).toBe(`bytes 8-${bytes.length - 1}/${bytes.length}`);
    expect(oversizedEnd.rawPayload.equals(bytes.subarray(8))).toBe(true);
    const suffix = await app.inject({ method: 'GET', url: `/api/v1/media/assets/${asset.id}/content`, headers: { range: 'bytes=-8' } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload.equals(bytes.subarray(-8))).toBe(true);
    const unsatisfiable = await app.inject({ method: 'GET', url: `/api/v1/media/assets/${asset.id}/content`, headers: { range: `bytes=${bytes.length}-` } });
    expect(unsatisfiable.statusCode).toBe(416);
    expect(unsatisfiable.headers['content-range']).toBe(`bytes */${bytes.length}`);
    expect(media.assets(project.id)).toHaveLength(1);
    await app.close();
  });

  it('rejects mislabeled or unsupported assets and does not store them', () => {
    expect(() => media.importAsset({ filename: 'fake.png', mime_type: 'image/png', base64: Buffer.from('<script>bad</script>').toString('base64') })).toThrow(/does not match/);
    expect(() => media.importAsset({ filename: 'malicious.svg', mime_type: 'image/svg+xml', base64: tinyPng })).toThrow(/Unsupported preview format/);
    expect(() => media.importAsset({ filename: 'bad.png', mime_type: 'image/png', base64: '../not-base64' })).toThrow(/Invalid or oversized/);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('associates imported assets with library items and clears references after deletion', () => {
    const asset = media.importAsset({ filename: 'cover.png', mime_type: 'image/png', base64: tinyPng });
    const item = media.saveItem({ title: 'Cover concept', type: 'image', asset_id: asset.id });
    expect(media.getItem(item.id)?.asset_id).toBe(asset.id);
    expect(media.deleteAsset(asset.id)).toBe(true);
    expect(media.getItem(item.id)?.asset_id).toBeNull();
    expect(media.getAsset(asset.id)).toBeNull();
  });
});
