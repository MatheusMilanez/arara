import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { searchDocuments } from '../../database/queries.js';
import { logger } from '../../observability/logger.js';

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  dataset: z.string().optional(),
});

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

    const result = await searchDocuments(q, { limit, offset, ...(dataset ? { datasetId: dataset } : {}) });

    const durationMs = Math.round(performance.now() - start);
    logger.info({ component: 'search', q, limit, offset, total: result.total, durationMs }, 'Search executed');

    return {
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
  });
}
