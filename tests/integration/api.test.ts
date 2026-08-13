import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/database/client.js';
import { insertDataset, insertDocument } from '../../src/database/queries.js';

describe('API routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with service statuses', async () => {
      const res = await request(app.server).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.services.database.status).toBe('ok');
    });
  });

  describe('GET /api/v1/datasets', () => {
    it('returns an empty list when no datasets exist', async () => {
      const res = await request(app.server).get('/api/v1/datasets');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, data: [] });
    });

    it('returns inserted datasets', async () => {
      await insertDataset({ source: 'test-source', name: 'Test Dataset' });
      const res = await request(app.server).get('/api/v1/datasets');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].source).toBe('test-source');
    });
  });

  describe('GET /api/v1/search', () => {
    it('returns 400 for an empty query', async () => {
      const res = await request(app.server).get('/api/v1/search').query({ q: '' });
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('returns 400 for limit above 100', async () => {
      const res = await request(app.server).get('/api/v1/search').query({ q: 'teste', limit: 101 });
      expect(res.status).toBe(400);
    });

    it('returns an empty array for no matches', async () => {
      const res = await request(app.server).get('/api/v1/search').query({ q: 'inexistente-xyz' });
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns matching documents ranked by relevance', async () => {
      const dataset = await insertDataset({ source: 'test-source', name: 'Test Dataset' });
      await insertDocument({ datasetId: dataset.id, title: 'Educação no Brasil', content: 'Dados sobre escolas' });

      const res = await request(app.server).get('/api/v1/search').query({ q: 'educacao' });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].dataset).toBe('test-source');
    });
  });
});
