import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/database/client.js';
import { insertDataset, searchDocuments, upsertDocuments } from '../../src/database/queries.js';

afterEach(async () => {
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy;
}

// ARARA-220: martela concorrência de propósito, em cima do que ARARA-210
// (upsert ordenado) e ARARA-211 (pool tunado) já garantem — aqui a escala é
// maior (100 chamadas, não 2) e mais realista (chaves e ordens aleatórias).
describe('100 escritas paralelas na mesma tabela', () => {
  it('não gera deadlock nem erro, mesmo com chaves sobrepostas em ordens aleatórias', async () => {
    const dataset = await insertDataset({ source: 'race-writes', name: 'Race writes' });
    const keys = Array.from({ length: 20 }, (_, i) => `key-${i}`);

    const writes = Array.from({ length: 100 }, (_, i) => {
      const subset = shuffled(keys).slice(0, 5 + (i % 5));
      return upsertDocuments(
        subset.map((externalId) => ({
          datasetId: dataset.id,
          externalId,
          title: `Título ${externalId} v${i}`,
          content: `Conteúdo da escrita ${i}`,
        })),
      );
    });

    const results = await Promise.allSettled(writes);
    const failures = results.filter((r) => r.status === 'rejected');

    expect(failures).toEqual([]);

    const { rows } = await pool.query<{ count: string }>('SELECT COUNT(*)::int AS count FROM documents WHERE dataset_id = $1', [
      dataset.id,
    ]);
    expect(Number(rows[0]?.count)).toBe(keys.length);
  }, 30_000);
});

describe('50 buscas concorrentes durante uma ingestão', () => {
  it('nenhuma busca falha, e o estado final é consistente', async () => {
    const dataset = await insertDataset({ source: 'race-search', name: 'Race search' });
    const total = 40;
    const term = 'concorrenciatest';

    const ingestion = upsertDocuments(
      Array.from({ length: total }, (_, i) => ({
        datasetId: dataset.id,
        externalId: `doc-${i}`,
        title: `Documento ${i}`,
        content: `Registro de teste sobre ${term} número ${i}`,
      })),
    );

    const searches = Array.from({ length: 50 }, () => searchDocuments(term, { datasetId: dataset.id }));

    const [ingestionResult, ...searchResults] = await Promise.allSettled([ingestion, ...searches]);

    expect(ingestionResult.status).toBe('fulfilled');
    expect(searchResults.every((r) => r.status === 'fulfilled')).toBe(true);

    // depois que tudo assentou, o total tem que bater — nenhuma escrita
    // sumiu por causa da leitura concorrente, nenhuma leitura travou o insert
    const final = await searchDocuments(term, { datasetId: dataset.id });
    expect(final.total).toBe(total);
  }, 30_000);
});
