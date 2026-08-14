import pg from 'pg';
import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';
import { checkRedisHealth } from '../../src/cache/redis.js';
import { checkDatabaseHealth, pool } from '../../src/database/client.js';

const { Pool } = pg;

describe('checkDatabaseHealth', () => {
  it('returns status ok against a reachable pool', async () => {
    const result = await checkDatabaseHealth();
    expect(result.status).toBe('ok');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns status error with a message when the pool cannot reach the database', async () => {
    const brokenPool = new Pool({ host: '127.0.0.1', port: 1, connectionTimeoutMillis: 500 });

    const result = await checkDatabaseHealth(brokenPool);

    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();

    await brokenPool.end();
  });
});

describe('pool error handler', () => {
  it('does not crash the process when the pool emits an unexpected error', () => {
    // sem o handler registrado em client.ts, um 'error' sem listener faz o
    // EventEmitter lançar de forma síncrona — é exatamente isso que testamos
    expect(() => pool.emit('error', new Error('conexão perdida'))).not.toThrow();
  });
});

describe('checkRedisHealth', () => {
  it('returns status ok against a reachable client', async () => {
    const result = await checkRedisHealth();
    expect(result.status).toBe('ok');
  });

  it('returns status error with a message when the client cannot connect', async () => {
    const brokenClient = createClient({
      url: 'redis://127.0.0.1:1',
      socket: { connectTimeout: 500, reconnectStrategy: false },
    });
    brokenClient.on('error', () => {}); // evita crash por 'error' sem listener

    const result = await checkRedisHealth(brokenClient);

    expect(result.status).toBe('error');
    expect(result.error).toBeTruthy();
  });
});
