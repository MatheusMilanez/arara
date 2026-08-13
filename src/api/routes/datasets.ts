import type { FastifyInstance } from 'fastify';
import { listDatasets } from '../../database/queries.js';

export async function datasetsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/datasets', async () => {
    const datasets = await listDatasets();

    return {
      ok: true,
      data: datasets.map((dataset) => ({
        id: dataset.id,
        source: dataset.source,
        name: dataset.name,
        description: dataset.description,
        row_count: dataset.rowCount,
        indexed_at: dataset.indexedAt,
        metadata: dataset.metadata,
      })),
    };
  });
}
