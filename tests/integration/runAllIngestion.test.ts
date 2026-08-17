import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/database/client.js';
import { getDatasetBySource } from '../../src/database/queries.js';
import { runAll } from '../../src/services/ingester/runAll.js';

function buildTseZip(): Buffer {
  const header = ['SQ_CANDIDATO', 'NM_URNA_CANDIDATO', 'DS_CARGO', 'SG_PARTIDO', 'SG_UF', 'NM_UE'].join(';');
  const row = ['"1"', '"FULANO"', '"VEREADOR"', '"PDT"', '"AC"', '"CIDADE AC"'].join(';');
  const zip = new AdmZip();
  zip.addFile('consulta_cand_2024_AC.csv', Buffer.from([header, row].join('\r\n'), 'latin1'));
  return zip.toBuffer();
}

function buildInepZip(): Buffer {
  const header = ['CO_ENTIDADE', 'NO_ENTIDADE', 'SG_UF', 'TP_SITUACAO_FUNCIONAMENTO'].join(';');
  const row = ['1', 'Escola Teste', 'RO', '1'].join(';');
  const zip = new AdmZip();
  zip.addFile(
    'microdados_censo_escolar_2025_v2/dados/Tabela_Escola_2025_V2.csv',
    Buffer.from([header, row].join('\r\n'), 'latin1'),
  );
  return zip.toBuffer();
}

function zipResponse(buf: Buffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as Response;
}

function ibgeResponse(uf: string): Response {
  return { ok: true, status: 200, json: async () => [{ id: 1, nome: `Cidade ${uf}` }] } as unknown as Response;
}

// stub único de fetch cobrindo os 3 datasources reais, roteando pela URL —
// mantém runAll() e os 3 run() de verdade intocados, só troca a rede
function stubFetch(options: { tseFails?: boolean } = {}): void {
  const tseZip = buildTseZip();
  const inepZip = buildInepZip();

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('servicodados.ibge.gov.br')) {
        const uf = url.match(/estados\/([A-Z]{2})\/municipios/)?.[1] ?? 'XX';
        return Promise.resolve(ibgeResponse(uf));
      }
      if (url.includes('cdn.tse.jus.br')) {
        return options.tseFails ? Promise.reject(new Error('TSE indisponível')) : Promise.resolve(zipResponse(tseZip));
      }
      if (url.includes('download.inep.gov.br')) {
        return Promise.resolve(zipResponse(inepZip));
      }
      return Promise.reject(new Error(`URL inesperada no teste: ${url}`));
    }),
  );
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

describe('runAll (ingestão paralela)', () => {
  it('roda os 3 datasources em paralelo e insere os documentos de cada um', async () => {
    stubFetch();

    const { succeeded, failed } = await runAll();

    expect(succeeded.sort()).toEqual(['ibge-municipios', 'inep-escolas-2025', 'tse-candidatos-2024']);
    expect(failed).toEqual([]);

    const ibge = await getDatasetBySource('ibge-municipios');
    const tse = await getDatasetBySource('tse-candidatos-2024');
    const inep = await getDatasetBySource('inep-escolas-2025');

    expect(ibge?.rowCount).toBe(27); // uma cidade fake por UF
    expect(tse?.rowCount).toBe(1);
    expect(inep?.rowCount).toBe(1);
  }, 30_000);

  it('isola a falha de um datasource: os outros dois terminam normalmente', async () => {
    stubFetch({ tseFails: true });

    const { succeeded, failed } = await runAll();

    expect(succeeded.sort()).toEqual(['ibge-municipios', 'inep-escolas-2025']);
    expect(failed).toEqual(['tse-candidatos-2024']);

    // IBGE e INEP não podem ter sido afetados pela falha do TSE
    const ibge = await getDatasetBySource('ibge-municipios');
    const inep = await getDatasetBySource('inep-escolas-2025');
    expect(ibge?.rowCount).toBe(27);
    expect(inep?.rowCount).toBe(1);

    // o dataset é criado antes do fetch (placeholder), então existe mesmo com
    // a ingestão falhando — só nunca chega a ser marcado como indexado
    const tse = await getDatasetBySource('tse-candidatos-2024');
    expect(tse?.rowCount).toBeNull();
    expect(tse?.indexedAt).toBeNull();

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [tse?.id],
    );
    expect(rows[0]?.count).toBe(0);
  }, 30_000);
});
