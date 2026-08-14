import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/database/client.js';
import { getDatasetBySource } from '../../src/database/queries.js';
import { run } from '../../src/services/ingester/datasources/tseCandidatos.js';

const HEADER = ['SQ_CANDIDATO', 'NM_URNA_CANDIDATO', 'DS_CARGO', 'SG_PARTIDO', 'SG_UF', 'NM_UE'].join(';');

function csvRow(sqCandidato: string, uf: string): string {
  return `"${sqCandidato}";"CANDIDATO ${sqCandidato}";"VEREADOR";"PDT";"${uf}";"CIDADE ${uf}"`;
}

// 3 candidaturas em 2 arquivos por UF, mais o consolidado (que run() deve ignorar)
const TOTAL_CANDIDATOS = 3;

function stubTseApi(): void {
  const zip = new AdmZip();
  zip.addFile('consulta_cand_2024_AC.csv', Buffer.from([HEADER, csvRow('1', 'AC'), csvRow('2', 'AC')].join('\r\n'), 'latin1'));
  zip.addFile('consulta_cand_2024_RR.csv', Buffer.from([HEADER, csvRow('3', 'RR')].join('\r\n'), 'latin1'));
  zip.addFile(
    'consulta_cand_2024_BRASIL.csv',
    Buffer.from([HEADER, csvRow('1', 'AC'), csvRow('2', 'AC'), csvRow('3', 'RR')].join('\r\n'), 'latin1'),
  );
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

describe('tseCandidatos run()', () => {
  it('creates the dataset and inserts one document per candidatura, ignoring the consolidated file', async () => {
    stubTseApi();

    await run();

    const dataset = await getDatasetBySource('tse-candidatos-2024');
    expect(dataset).not.toBeNull();
    expect(dataset?.rowCount).toBe(TOTAL_CANDIDATOS);

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(TOTAL_CANDIDATOS);
  }, 20_000);

  it('is idempotent: re-running replaces the previous batch instead of duplicating it', async () => {
    stubTseApi();

    await run();
    await run();

    const dataset = await getDatasetBySource('tse-candidatos-2024');
    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(TOTAL_CANDIDATOS);
  }, 30_000);
});
