import { afterEach, describe, expect, it } from 'vitest';
import { pool } from '../../src/database/client.js';
import {
  getDatasetBySource,
  getDocument,
  insertDataset,
  insertDocument,
  listDatasets,
  markDatasetIndexed,
  searchDocuments,
} from '../../src/database/queries.js';

afterEach(async () => {
  await pool.query('TRUNCATE TABLE documents, datasets RESTART IDENTITY CASCADE');
});

describe('datasets', () => {
  it('inserts and finds a dataset by source', async () => {
    const created = await insertDataset({ source: 'src-a', name: 'A' });
    const found = await getDatasetBySource('src-a');
    expect(found?.id).toBe(created.id);
  });

  it('returns null for an unknown source', async () => {
    const found = await getDatasetBySource('does-not-exist');
    expect(found).toBeNull();
  });

  it('lists datasets with the most recently indexed first', async () => {
    const a = await insertDataset({ source: 'a', name: 'A' });
    const b = await insertDataset({ source: 'b', name: 'B' });
    await markDatasetIndexed(a.id, 10);

    const datasets = await listDatasets();
    expect(datasets[0]?.id).toBe(a.id);
    expect(datasets.map((d) => d.id)).toContain(b.id);
  });
});

describe('documents', () => {
  it('inserts a document and fetches it back', async () => {
    const dataset = await insertDataset({ source: 'src', name: 'Src' });
    const doc = await insertDocument({ datasetId: dataset.id, title: 'Title', content: 'Content' });
    const fetched = await getDocument(doc.id);
    expect(fetched).toEqual(doc);
  });

  it('returns null for a missing document', async () => {
    const fetched = await getDocument('00000000-0000-0000-0000-000000000000');
    expect(fetched).toBeNull();
  });

  it('is deleted when its dataset is deleted (ON DELETE CASCADE)', async () => {
    const dataset = await insertDataset({ source: 'src', name: 'Src' });
    const doc = await insertDocument({ datasetId: dataset.id, title: 'Title' });

    await pool.query('DELETE FROM datasets WHERE id = $1', [dataset.id]);

    expect(await getDocument(doc.id)).toBeNull();
  });
});

describe('searchDocuments', () => {
  it('finds documents by relevance, accent-insensitive', async () => {
    const dataset = await insertDataset({ source: 'src', name: 'Src' });
    await insertDocument({ datasetId: dataset.id, title: 'Educação no Brasil', content: 'Escolas públicas' });

    const result = await searchDocuments('educacao');
    expect(result.total).toBe(1);
    expect(result.documents[0]?.dataset).toBe('src');
  });

  it('paginates results', async () => {
    const dataset = await insertDataset({ source: 'src', name: 'Src' });
    for (let i = 0; i < 5; i += 1) {
      await insertDocument({ datasetId: dataset.id, title: `Item ${i}`, content: 'busca teste' });
    }

    const page1 = await searchDocuments('busca', { limit: 2, offset: 0 });
    const page2 = await searchDocuments('busca', { limit: 2, offset: 2 });

    expect(page1.documents).toHaveLength(2);
    expect(page2.documents).toHaveLength(2);
    expect(page1.total).toBe(5);
  });

  it('filters by datasetId', async () => {
    const datasetA = await insertDataset({ source: 'a', name: 'A' });
    const datasetB = await insertDataset({ source: 'b', name: 'B' });
    await insertDocument({ datasetId: datasetA.id, title: 'Alpha', content: 'busca teste' });
    await insertDocument({ datasetId: datasetB.id, title: 'Beta', content: 'busca teste' });

    const result = await searchDocuments('busca', { datasetId: datasetA.id });
    expect(result.total).toBe(1);
    expect(result.documents[0]?.dataset).toBe('a');
  });

  it('returns an empty result for no matches', async () => {
    const result = await searchDocuments('zzz-inexistente');
    expect(result.documents).toEqual([]);
    expect(result.total).toBe(0);
  });
});
