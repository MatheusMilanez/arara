import 'dotenv/config';
import { buildApp } from './app.js';
import { closeRedis } from './cache/redis.js';
import { closePool, startPoolMonitor } from './database/client.js';
import { logger } from './observability/logger.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = await buildApp();
const stopPoolMonitor = startPoolMonitor();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  try {
    stopPoolMonitor();
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
