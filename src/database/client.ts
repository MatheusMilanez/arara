import 'dotenv/config';
import pg from 'pg';
import { logger } from '../observability/logger.js';

const { Pool } = pg;

// ARARA-211: max cobre o pico de 3 ingestões em paralelo + tráfego normal da
// API; min mantém conexões abertas prontas (evita pagar o custo de handshake
// TCP+TLS+auth do Postgres a cada pico de tráfego depois de um período ocioso)
const POOL_MAX = 20;
const POOL_MIN = 10;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  min: POOL_MIN,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Errors on idle clients (e.g. connection dropped by the server) don't
// reject any query promise, so without this handler they crash the process.
pool.on('error', (err) => {
  logger.error({ component: 'database', error: err instanceof Error ? err.message : String(err) }, 'Unexpected error on idle database client');
});

export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

const POOL_WARN_RATIO = 0.8;

// função pura, separada do timer, pra poder testar a decisão sem mockar
// logger nem relógio
export function isPoolNearCapacity(stats: PoolStats, max = POOL_MAX, warnRatio = POOL_WARN_RATIO): boolean {
  return stats.waitingCount > 0 || stats.totalCount >= max * warnRatio;
}

// ARARA-211: log periódico do estado do pool — sinal complementar ao gauge
// do Prometheus (database_pool_connections em metrics.ts), que só existe
// enquanto alguém está fazendo scrape; isso fica no histórico de logs mesmo
// sem um Prometheus rodando.
export function startPoolMonitor(intervalMs = 30_000): () => void {
  const timer = setInterval(() => {
    const stats: PoolStats = { totalCount: pool.totalCount, idleCount: pool.idleCount, waitingCount: pool.waitingCount };
    logger.debug({ component: 'database', ...stats }, 'Estado do pool de conexões');

    if (isPoolNearCapacity(stats)) {
      logger.warn({ component: 'database', ...stats, max: POOL_MAX }, 'Pool de conexões perto do limite');
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export interface DatabaseHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

// `targetPool` é injetável pra permitir testar o caminho de erro com um pool
// apontado pra um endereço inválido, sem precisar derrubar o Postgres real
export async function checkDatabaseHealth(targetPool: pg.Pool = pool): Promise<DatabaseHealth> {
  const start = performance.now();

  try {
    await targetPool.query('SELECT 1');
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
