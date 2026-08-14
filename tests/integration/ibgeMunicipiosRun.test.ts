import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/database/client.js';
import { getDatasetBySource } from '../../src/database/queries.js';
import { run } from '../../src/services/ingester/datasources/ibgeMunicipios.js';

const TOTAL_UFS = 27;

function stubIbgeApi(): void {
  const fetchMock = vi.fn((input: string | URL | Request) => {
    const uf = String(input).match(/estados\/([A-Z]{2})\/municipios/)?.[1] ?? 'XX';
    const body = [
      {
        id: Math.floor(Math.random() * 1_000_000),
        nome: `Cidade ${uf}`,
        microrregiao: { mesorregiao: { UF: { sigla: uf, nome: uf, regiao: { nome: 'Regiao' } } } },
      },
    ];
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

describe('ibgeMunicipios run()', () => {
  it('creates the dataset and inserts one document per municipio', async () => {
    stubIbgeApi();

    await run();

    const dataset = await getDatasetBySource('ibge-municipios');
    expect(dataset).not.toBeNull();
    expect(dataset?.rowCount).toBe(TOTAL_UFS);

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(TOTAL_UFS);
  }, 20_000);

  it('is idempotent: re-running replaces the previous batch instead of duplicating it', async () => {
    stubIbgeApi();

    await run();
    await run();

    const dataset = await getDatasetBySource('ibge-municipios');
    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(TOTAL_UFS);
  }, 30_000);
});
