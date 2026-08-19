import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCachedSearch, setCachedSearch } from '../../cache/searchCache.js';
import { searchDocuments } from '../../database/queries.js';
import { logger } from '../../observability/logger.js';
import { recordSearchCacheHit, recordSearchCacheMiss, searchLatencyMs } from '../../observability/metrics.js';

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  dataset: z.string().optional(),
});

interface SearchResponseBody {
  ok: true;
  data: Array<{
    id: string;
    title: string | null;
    dataset: string;
    relevance: number;
    metadata: Record<string, unknown> | null;
    source_url: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/search', async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid query parameters',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { q, limit, offset, dataset } = parsed.data;
    const start = performance.now();
    const cacheParams = { q, limit, offset, ...(dataset ? { datasetId: dataset } : {}) };

    const cached = await getCachedSearch<SearchResponseBody>(cacheParams);
    if (cached) {
      recordSearchCacheHit();
      const durationMs = Math.round(performance.now() - start);
      searchLatencyMs.observe({ cache: 'hit' }, durationMs);
      logger.info({ component: 'search', q, limit, offset, cache: 'hit', durationMs }, 'Search executed');
      return cached;
    }
    recordSearchCacheMiss();

    const result = await searchDocuments(q, { limit, offset, ...(dataset ? { datasetId: dataset } : {}) });

    const durationMs = Math.round(performance.now() - start);
    searchLatencyMs.observe({ cache: 'miss' }, durationMs);
    logger.info({ component: 'search', q, limit, offset, total: result.total, cache: 'miss', durationMs }, 'Search executed');

    const body: SearchResponseBody = {
      ok: true,
      data: result.documents.map((doc) => ({
        id: doc.id,
        title: doc.title,
        dataset: doc.dataset,
        relevance: doc.relevance,
        metadata: doc.metadata,
        source_url: doc.sourceUrl,
      })),
      total: result.total,
      limit,
      offset,
    };

    await setCachedSearch(cacheParams, body);

    return body;
  });
}
