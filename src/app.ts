import 'dotenv/config';
import Fastify from 'fastify';
import { datasetsRoutes } from './api/routes/datasets.js';
import { healthRoutes } from './api/routes/health.js';
import { searchRoutes } from './api/routes/search.js';
import { closeRedis } from './cache/redis.js';
import { closePool } from './database/client.js';
import { logger } from './observability/logger.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({ loggerInstance: logger });

app.get('/', async () => {
  return { ok: true, service: 'arara' };
});

await app.register(healthRoutes, { prefix: '/api/v1' });
await app.register(datasetsRoutes, { prefix: '/api/v1' });
await app.register(searchRoutes, { prefix: '/api/v1' });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  try {
    await app.close();
    await Promise.all([closePool(), closeRedis()]);
    process.exit(0);
  } catch (err) {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`ARARA listening on port ${PORT}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
