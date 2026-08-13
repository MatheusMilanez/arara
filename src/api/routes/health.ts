import type { FastifyInstance } from 'fastify';
import { checkRedisHealth } from '../../cache/redis.js';
import { checkDatabaseHealth } from '../../database/client.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
    const allOk = database.status === 'ok' && redis.status === 'ok';

    const body = {
      status: allOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      services: {
        database: { status: database.status, latency_ms: database.latencyMs },
        redis: { status: redis.status, latency_ms: redis.latencyMs },
      },
    };

    return reply.status(allOk ? 200 : 503).send(body);
  });
}
