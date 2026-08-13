import 'dotenv/config';
import { createClient } from 'redis';

export const redisClient = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' });

redisClient.on('error', (err: unknown) => {
  console.error('Unexpected Redis client error', err);
});

let isConnected = false;

async function ensureConnected(): Promise<void> {
  if (!isConnected) {
    await redisClient.connect();
    isConnected = true;
  }
}

export interface CacheHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

export async function checkRedisHealth(): Promise<CacheHealth> {
  const start = performance.now();

  try {
    await ensureConnected();
    await redisClient.ping();
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
  if (isConnected) {
    await redisClient.quit();
    isConnected = false;
  }
}
