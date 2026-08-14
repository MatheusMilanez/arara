import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/database/client.js';
import { getDatasetBySource } from '../../src/database/queries.js';
import { run } from '../../src/services/ingester/datasources/inepEscolas.js';

const HEADER = ['CO_ENTIDADE', 'NO_ENTIDADE', 'SG_UF', 'TP_SITUACAO_FUNCIONAMENTO'].join(';');

// 2 ativas + 1 paralisada — run() deve indexar só as 2 ativas
const TOTAL_ATIVAS = 2;

function stubInepApi(): void {
  const zip = new AdmZip();
  const rows = [
    '1;Escola A;RO;1',
    '2;Escola B;RO;1',
    '3;Escola Fechada;RO;2',
  ];
  zip.addFile('microdados_censo_escolar_2025_v2/dados/Tabela_Escola_2025_V2.csv', Buffer.from([HEADER, ...rows].join('\r\n'), 'latin1'));
  const buf = zip.toBuffer();

  const fetchMock = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response),
  );
  vi.stubGlobal('fetch', fetchMock);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

describe('inepEscolas run()', () => {
  it('creates the dataset and inserts one document per active school', async () => {
    stubInepApi();

    await run();

    const dataset = await getDatasetBySource('inep-escolas-2025');
    expect(dataset).not.toBeNull();
    expect(dataset?.rowCount).toBe(TOTAL_ATIVAS);
    expect(dataset?.metadata).toEqual({ anoCenso: '2025', fonte: expect.stringContaining('download.inep.gov.br') });

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(TOTAL_ATIVAS);
  }, 20_000);

  it('is idempotent: re-running replaces the previous batch instead of duplicating it', async () => {
    stubInepApi();

    await run();
    await run();

    const dataset = await getDatasetBySource('inep-escolas-2025');
    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(TOTAL_ATIVAS);
  }, 30_000);
});
