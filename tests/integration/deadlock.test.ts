import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/database/client.js';
import { insertDataset, upsertDocuments } from '../../src/database/queries.js';

afterEach(async () => {
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

function lockRow(client: Client, datasetId: string, externalId: string): Promise<unknown> {
  return client.query('SELECT id FROM documents WHERE dataset_id = $1 AND external_id = $2 FOR UPDATE', [
    datasetId,
    externalId,
  ]);
}

// Reproduz o mecanismo genérico de deadlock do Postgres direto, sem passar
// pelo upsertDocuments() de produção (que já nasce protegido pelo sort) —
// prova que o risco é real pra essa tabela, independente do nosso código.
describe('deadlock em locks concorrentes (ARARA-210)', () => {
  it('duas transações travando as mesmas linhas em ordem trocada terminam em deadlock', async () => {
    const dataset = await insertDataset({ source: 'deadlock-demo-crossed', name: 'Deadlock demo' });
    await upsertDocuments([
      { datasetId: dataset.id, externalId: 'x', title: 'X' },
      { datasetId: dataset.id, externalId: 'y', title: 'Y' },
    ]);

    const a = await connect();
    const b = await connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      // A trava x, B trava y — sem conflito ainda
      await lockRow(a, dataset.id, 'x');
      await lockRow(b, dataset.id, 'y');

      // agora A quer y (que B segura) e B quer x (que A segura), ao mesmo tempo
      const aWantsY = lockRow(a, dataset.id, 'y');
      const bWantsX = lockRow(b, dataset.id, 'x');

      const [resultA, resultB] = await Promise.allSettled([aWantsY, bWantsX]);
      const statuses = [resultA.status, resultB.status];

      expect(statuses).toContain('rejected');
      expect(statuses).toContain('fulfilled');

      const rejected = resultA.status === 'rejected' ? resultA : (resultB as PromiseRejectedResult);
      expect((rejected.reason as Error).message).toMatch(/deadlock detected/);
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      await b.query('ROLLBACK').catch(() => {});
      await a.end();
      await b.end();
    }
  }, 15_000);

  it('travando as mesmas linhas sempre na mesma ordem, ninguém é abortado — só espera', async () => {
    const dataset = await insertDataset({ source: 'deadlock-demo-ordered', name: 'Deadlock demo ordenado' });
    await upsertDocuments([
      { datasetId: dataset.id, externalId: 'x', title: 'X' },
      { datasetId: dataset.id, externalId: 'y', title: 'Y' },
    ]);

    const a = await connect();
    const b = await connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      // as duas pedem x primeiro, y depois — mesma ordem, ciclo impossível
      await lockRow(a, dataset.id, 'x');
      const bWantsX = lockRow(b, dataset.id, 'x'); // B fica esperando A soltar x

      await lockRow(a, dataset.id, 'y');
      await a.query('COMMIT'); // libera x e y

      await expect(bWantsX).resolves.toBeDefined();
      await lockRow(b, dataset.id, 'y');
      await b.query('COMMIT');
    } finally {
      await a.query('ROLLBACK').catch(() => {});
      await b.query('ROLLBACK').catch(() => {});
      await a.end();
      await b.end();
    }
  }, 15_000);

  it('upsertDocuments real: duas chamadas concorrentes com chaves sobrepostas em ordem invertida não deadlockam', async () => {
    const dataset = await insertDataset({ source: 'deadlock-demo-real', name: 'Deadlock demo real' });

    const ascending = [
      { datasetId: dataset.id, externalId: 'a', title: 'A' },
      { datasetId: dataset.id, externalId: 'b', title: 'B' },
      { datasetId: dataset.id, externalId: 'c', title: 'C' },
    ];
    const descending = [...ascending].reverse();

    const [resultA, resultB] = await Promise.allSettled([upsertDocuments(ascending), upsertDocuments(descending)]);

    expect(resultA.status).toBe('fulfilled');
    expect(resultB.status).toBe('fulfilled');
  });
});
