import { createClient } from 'redis';
import { afterEach, describe, expect, it } from 'vitest';
import { redisClient } from '../../src/cache/redis.js';
import { getCachedSearch, invalidateSearchCache, setCachedSearch, type SearchCacheClient } from '../../src/cache/searchCache.js';

afterEach(async () => {
  if (!redisClient.isOpen) await redisClient.connect();
  await redisClient.del('search:generation');
});

describe('searchCache', () => {
  it('retorna null quando não há nada em cache', async () => {
    const result = await getCachedSearch({ q: 'termo-nunca-usado-xyz', limit: 20, offset: 0 });
    expect(result).toBeNull();
  });

  it('grava e lê o mesmo valor de volta', async () => {
    const params = { q: 'termo-cache-roundtrip', limit: 20, offset: 0 };
    await setCachedSearch(params, { total: 3 });

    expect(await getCachedSearch(params)).toEqual({ total: 3 });
  });

  it('mesma busca com datasetId diferente não colide na mesma chave', async () => {
    const base = { q: 'termo-dataset-colisao', limit: 20, offset: 0 };
    await setCachedSearch({ ...base, datasetId: 'dataset-a' }, { total: 1 });
    await setCachedSearch({ ...base, datasetId: 'dataset-b' }, { total: 2 });

    expect(await getCachedSearch({ ...base, datasetId: 'dataset-a' })).toEqual({ total: 1 });
    expect(await getCachedSearch({ ...base, datasetId: 'dataset-b' })).toEqual({ total: 2 });
  });

  it('invalidateSearchCache faz o valor antigo parar de ser visto', async () => {
    const params = { q: 'termo-invalidacao', limit: 20, offset: 0 };
    await setCachedSearch(params, { total: 1 });
    expect(await getCachedSearch(params)).toEqual({ total: 1 });

    await invalidateSearchCache();

    expect(await getCachedSearch(params)).toBeNull();
  });

  describe('fallback quando o Redis está fora do ar', () => {
    function brokenClient(): SearchCacheClient {
      const client = createClient({
        url: 'redis://127.0.0.1:1',
        socket: { connectTimeout: 500, reconnectStrategy: false },
      });
      client.on('error', () => {}); // evita crash por 'error' sem listener
      return client as unknown as SearchCacheClient;
    }

    it('getCachedSearch não lança — retorna null e deixa a busca cair pro banco', async () => {
      const result = await getCachedSearch({ q: 'x', limit: 20, offset: 0 }, brokenClient());
      expect(result).toBeNull();
    });

    it('setCachedSearch não lança', async () => {
      await expect(
        setCachedSearch({ q: 'x', limit: 20, offset: 0 }, { total: 1 }, brokenClient()),
      ).resolves.toBeUndefined();
    });

    it('invalidateSearchCache não lança', async () => {
      await expect(invalidateSearchCache(brokenClient())).resolves.toBeUndefined();
    });
  });
});
