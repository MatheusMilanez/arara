import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// roda o script de migrations contra um Postgres isolado (não o container
// compartilhado do resto da suíte), do jeito que um contribuidor novo faria
// num clone limpo: `npm run migrate:up` / `migrate:down`
describe('migrations CLI (smoke test)', () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:14').start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client.end();
    await container.stop();
  }, 30_000);

  async function runMigrationCommand(command: 'up' | 'down'): Promise<void> {
    await execFileAsync('npx', ['tsx', 'src/database/migrations.ts', command], {
      env: { ...process.env, DATABASE_URL: container.getConnectionUri() },
      shell: true,
      cwd: process.cwd(),
    });
  }

  it('applies every migration from an empty database', async () => {
    await runMigrationCommand('up');

    const tables = await client.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const tableNames = tables.rows.map((row) => row.table_name);
    expect(tableNames).toEqual(expect.arrayContaining(['datasets', 'documents', 'schema_migrations']));

    const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.rows.map((row) => row.name)).toEqual([
      '001_initial_schema.up.sql',
      '002_accent_insensitive_search.up.sql',
      '003_document_external_id.up.sql',
    ]);
  }, 30_000);

  it('is idempotent: running up again applies nothing new', async () => {
    await runMigrationCommand('up');

    const applied = await client.query('SELECT name FROM schema_migrations');
    expect(applied.rowCount).toBe(3);
  }, 30_000);

  it('reverts only the last applied migration on down', async () => {
    await runMigrationCommand('down');

    const applied = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
    expect(applied.rows.map((row) => row.name)).toEqual([
      '001_initial_schema.up.sql',
      '002_accent_insensitive_search.up.sql',
    ]);

    // a coluna external_id é criada pela migration 003 — revertida, some
    const column = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'documents' AND column_name = 'external_id'",
    );
    expect(column.rowCount).toBe(0);

    // mas a config de busca sem acento da migration 002 (não revertida) continua de pé
    const config = await client.query("SELECT 1 FROM pg_ts_config WHERE cfgname = 'portuguese_unaccent'");
    expect(config.rowCount).toBe(1);
  }, 30_000);
});
