import Fastify from 'fastify';
import { datasetsRoutes } from './api/routes/datasets.js';
import { healthRoutes } from './api/routes/health.js';
import { metricsRoutes } from './api/routes/metrics.js';
import { searchRoutes } from './api/routes/search.js';
import { logger } from './observability/logger.js';

export async function buildApp() {
  const app = Fastify({ loggerInstance: logger });

  app.get('/', async () => {
    return { ok: true, service: 'arara' };
  });

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(datasetsRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  // sem prefixo /api/v1 de propósito: scrapers do Prometheus esperam /metrics
  // na raiz por convenção, não é um endpoint de negócio versionado
  await app.register(metricsRoutes);

  return app;
}
