import type { FastifyInstance } from 'fastify';
import { checkRedisHealth, type CacheHealth } from '../../cache/redis.js';
import { checkDatabaseHealth, type DatabaseHealth } from '../../database/client.js';

// separado do handler HTTP pra poder testar os dois branches (200/503) sem
// precisar derrubar Postgres ou Redis de verdade — só decisão pura
export function buildHealthResponse(
  database: DatabaseHealth,
  redis: CacheHealth,
): { statusCode: 200 | 503; body: Record<string, unknown> } {
  const allOk = database.status === 'ok' && redis.status === 'ok';

  return {
    statusCode: allOk ? 200 : 503,
    body: {
      status: allOk ? 'ok' : 'error',
      timestamp: new Date().toISOString(),
      services: {
        database: { status: database.status, latency_ms: database.latencyMs },
        redis: { status: redis.status, latency_ms: redis.latencyMs },
      },
    },
  };
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    const [database, redis] = await Promise.all([checkDatabaseHealth(), checkRedisHealth()]);
    const { statusCode, body } = buildHealthResponse(database, redis);
    return reply.status(statusCode).send(body);
  });
}
