import 'dotenv/config';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../migrations');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
}

function listUpMigrations(): string[] {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.up.sql'))
    .sort();
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  return new Set(result.rows.map((row) => row.name));
}

export async function up(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  const pending = listUpMigrations().filter((file) => !applied.has(file));

  if (pending.length === 0) {
    console.log('No pending migrations.');
    return;
  }

  for (const file of pending) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export async function down(): Promise<void> {
  await ensureMigrationsTable();
  const result = await pool.query<{ name: string }>(
    'SELECT name FROM schema_migrations ORDER BY applied_at DESC LIMIT 1',
  );
  const last = result.rows[0];

  if (!last) {
    console.log('No migrations to revert.');
    return;
  }

  const downFile = last.name.replace(/\.up\.sql$/, '.down.sql');
  const sql = readFileSync(path.join(migrationsDir, downFile), 'utf-8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('DELETE FROM schema_migrations WHERE name = $1', [last.name]);
    await client.query('COMMIT');
    console.log(`Reverted: ${last.name}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function create(name: string | undefined): void {
  if (!name) {
    throw new Error('Usage: npm run migrate:create -- <name>');
  }

  const existing = readdirSync(migrationsDir).filter((file) => /^\d+_/.test(file));
  const nextNumber =
    existing.length === 0
      ? 1
      : Math.max(...existing.map((file) => Number(file.split('_')[0]))) + 1;
  const base = `${String(nextNumber).padStart(3, '0')}_${name}`;

  writeFileSync(path.join(migrationsDir, `${base}.up.sql`), '-- Write your migration here\n');
  writeFileSync(path.join(migrationsDir, `${base}.down.sql`), '-- Write your rollback here\n');
  console.log(`Created: ${base}.up.sql / ${base}.down.sql`);
}

async function main(): Promise<void> {
  const command = process.argv[2];

  try {
    if (command === 'up') {
      await up();
    } else if (command === 'down') {
      await down();
    } else if (command === 'create') {
      create(process.argv[3]);
    } else {
      throw new Error(`Unknown command: ${String(command)}. Use up | down | create <name>`);
    }
  } finally {
    await pool.end();
  }
}

// Only auto-run when this file is executed directly (tsx src/database/migrations.ts),
// not when it's imported by tests — importing it must not connect/mutate a database.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
