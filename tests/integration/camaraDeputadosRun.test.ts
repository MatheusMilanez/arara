import { afterEach, describe, expect, it, vi } from 'vitest';
import { pool } from '../../src/database/client.js';
import { getDatasetBySource } from '../../src/database/queries.js';
import { run } from '../../src/services/ingester/datasources/camaraDeputados.js';

// um documento por combinação (tipo, janela) real vista pela API — os ids são
// atribuídos por chave, não por um contador global, então reexecutar dentro do
// mesmo teste gera exatamente os mesmos externalId de novo (mesmas janelas,
// "hoje" não muda no meio do teste)
function stubCamaraApi(): { ids: Map<string, number> } {
  const ids = new Map<string, number>();

  const fetchMock = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    const tipo = url.match(/siglaTipo=([A-Z]+)/)?.[1] ?? 'XX';
    const inicio = url.match(/dataApresentacaoInicio=([\d-]+)/)?.[1] ?? '';
    const pagina = url.match(/pagina=(\d+)/)?.[1] ?? '1';

    if (pagina !== '1') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ dados: [] }) } as unknown as Response);
    }

    const key = `${tipo}-${inicio}`;
    if (!ids.has(key)) ids.set(key, ids.size + 1);
    const id = ids.get(key)!;

    const body = {
      dados: [{ id, siglaTipo: tipo, numero: id, ano: 2024, ementa: `Ementa ${id}`, dataApresentacao: inicio }],
    };
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { ids };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

describe('camaraDeputados run()', () => {
  it('cria o dataset e faz upsert de um documento por proposição encontrada', async () => {
    const { ids } = stubCamaraApi();

    await run();

    const dataset = await getDatasetBySource('camara-proposicoes');
    expect(dataset).not.toBeNull();
    expect(dataset?.rowCount).toBe(ids.size);

    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(ids.size);
  }, 30_000);

  it('é idempotente via upsert: reexecutar atualiza os documentos em vez de duplicá-los', async () => {
    const { ids } = stubCamaraApi();

    await run();
    await run();

    const dataset = await getDatasetBySource('camara-proposicoes');
    const { rows } = await pool.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1',
      [dataset?.id],
    );
    expect(rows[0]?.count).toBe(ids.size);
  }, 45_000);
});
