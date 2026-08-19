import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateSearchCache } from '../../src/cache/searchCache.js';
import { redisClient } from '../../src/cache/redis.js';
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

  beforeEach(async () => {
    // garante geração nova a cada teste — sem isso, cache deixado por uma
    // rodada anterior da suíte (Redis não é efêmero como o Postgres de teste)
    // poderia vazar pra um teste que reusa o mesmo termo de busca
    await invalidateSearchCache();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
  });

  describe('GET / (ARARA-410)', () => {
    it('retorna ok e o nome do serviço', async () => {
      const res = await request(app.server).get('/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, service: 'arara' });
    });
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with service statuses', async () => {
      const res = await request(app.server).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.services.database.status).toBe('ok');
    });
  });

  describe('GET /metrics', () => {
    it('returns Prometheus-formatted metrics', async () => {
      const res = await request(app.server).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toContain('# HELP database_pool_connections');
      expect(res.text).toContain('# HELP ingest_duration_seconds');
      expect(res.text).toContain('# HELP search_latency_ms');
      expect(res.text).toContain('# HELP redis_memory_bytes');
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

    it('filtra por dataset quando o parâmetro dataset é passado (ARARA-410)', async () => {
      const datasetA = await insertDataset({ source: 'dataset-a', name: 'Dataset A' });
      const datasetB = await insertDataset({ source: 'dataset-b', name: 'Dataset B' });
      await insertDocument({ datasetId: datasetA.id, title: 'Datasetfiltrouniqueterm em A', content: 'x' });
      await insertDocument({ datasetId: datasetB.id, title: 'Datasetfiltrouniqueterm em B', content: 'x' });

      const res = await request(app.server)
        .get('/api/v1/search')
        .query({ q: 'datasetfiltrouniqueterm', dataset: datasetA.id });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].dataset).toBe('dataset-a');
    });

    describe('cache (ARARA-300)', () => {
      it('a segunda busca idêntica vem do cache — não reflete um documento inserido depois', async () => {
        const dataset = await insertDataset({ source: 'cache-source', name: 'Cache Dataset' });
        await insertDocument({ datasetId: dataset.id, title: 'Cachehttpuniqueterm primeiro', content: 'x' });

        const first = await request(app.server).get('/api/v1/search').query({ q: 'cachehttpuniqueterm' });
        expect(first.body.total).toBe(1);

        // insere um segundo documento que também bateria na mesma busca —
        // se a segunda chamada fosse ao banco, o total mudaria pra 2
        await insertDocument({ datasetId: dataset.id, title: 'Cachehttpuniqueterm segundo', content: 'x' });

        const second = await request(app.server).get('/api/v1/search').query({ q: 'cachehttpuniqueterm' });
        expect(second.body.total).toBe(1); // veio do cache, ainda não sabe do segundo documento
      });

      it('depois de invalidar o cache, a busca reflete o dado novo', async () => {
        const dataset = await insertDataset({ source: 'cache-source-2', name: 'Cache Dataset 2' });
        await insertDocument({ datasetId: dataset.id, title: 'Cacheinvalidacaouniqueterm primeiro', content: 'x' });

        await request(app.server).get('/api/v1/search').query({ q: 'cacheinvalidacaouniqueterm' });

        await insertDocument({ datasetId: dataset.id, title: 'Cacheinvalidacaouniqueterm segundo', content: 'x' });
        await invalidateSearchCache(); // é isso que cada ingestão real chama ao terminar

        const res = await request(app.server).get('/api/v1/search').query({ q: 'cacheinvalidacaouniqueterm' });
        expect(res.body.total).toBe(2);
      });
    });

    describe('chaos: Redis fora do ar (ARARA-401)', () => {
      it('busca continua funcionando (200, dado do Postgres) mesmo com o Redis indisponível', async () => {
        const dataset = await insertDataset({ source: 'chaos-source', name: 'Chaos Dataset' });
        await insertDocument({ datasetId: dataset.id, title: 'Chaosredisuniqueterm achado', content: 'x' });

        // simula o Redis fora do ar sem precisar derrubar o container real —
        // mesma técnica de falha que searchCache.test.ts já usa pro cache
        // isolado, aqui provando o mesmo comportamento na rota inteira
        vi.spyOn(redisClient, 'get').mockRejectedValue(new Error('Redis indisponível (simulado)'));
        vi.spyOn(redisClient, 'set').mockRejectedValue(new Error('Redis indisponível (simulado)'));

        const res = await request(app.server).get('/api/v1/search').query({ q: 'chaosredisuniqueterm' });

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
      });
    });
  });
});
