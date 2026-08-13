import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Errors on idle clients (e.g. connection dropped by the server) don't
// reject any query promise, so without this handler they crash the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

export interface DatabaseHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const start = performance.now();

  try {
    await pool.query('SELECT 1');
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
