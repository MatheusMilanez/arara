import 'dotenv/config';
import { createClient } from 'redis';
import { logger } from '../observability/logger.js';

// interface mínima que checkRedisHealth precisa — evita amarrar a assinatura
// à instanciação genérica exata de createClient(), que muda conforme as
// opções passadas e complica demais o tipo de um client injetado em teste
export interface RedisHealthClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
}

export const redisClient = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });

redisClient.on('error', (err: unknown) => {
  logger.error({ component: 'redis', error: err instanceof Error ? err.message : String(err) }, 'Unexpected Redis client error');
});

export interface CacheHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

// `client` é injetável pra permitir testar o caminho de erro com um client
// apontado pra um endereço inválido, sem precisar derrubar o Redis real
export async function checkRedisHealth(client: RedisHealthClient = redisClient): Promise<CacheHealth> {
  const start = performance.now();

  try {
    if (!client.isOpen) {
      await client.connect();
    }
    await client.ping();
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient.isOpen) {
    await redisClient.quit();
  }
}
