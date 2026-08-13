import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

// Runs once for the whole test run, before any test file is loaded. Setting
// process.env.DATABASE_URL here (rather than in a per-test beforeAll) means
// src/database/client.ts picks up the ephemeral container's connection
// string instead of the dev database, since its own `dotenv/config` import
// never overrides a variable that is already set.
export default async function setup(): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:14').start();
  const connectionString = container.getConnectionUri();

  const client = new Client({ connectionString });
  await client.connect();

  const migrationsDir = path.resolve(process.cwd(), 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.up.sql'))
    .sort();

  for (const file of files) {
    await client.query(readFileSync(path.join(migrationsDir, file), 'utf-8'));
  }

  await client.end();

  process.env.DATABASE_URL = connectionString;

  return async () => {
    await container.stop();
  };
}
