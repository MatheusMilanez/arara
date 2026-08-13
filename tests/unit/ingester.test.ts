import { describe, expect, it } from 'vitest';
import { DatasourceError, Ingester, IngestionError, TimeoutError } from '../../src/services/ingester/index.js';
import type { IngestionStrategy, RawData } from '../../src/services/ingester/types.js';

const datasetId = '00000000-0000-0000-0000-000000000000';

describe('Ingester', () => {
  it('normalizes fetched records into documents', async () => {
    const strategy: IngestionStrategy = {
      datasource: 'fake',
      async fetch(): Promise<RawData[]> {
        return [{ title: 'A' }, { title: 'B' }];
      },
      normalize(data: RawData) {
        return { datasetId, title: String(data['title']), content: null };
      },
    };

    const docs = await new Ingester(strategy).run();
    expect(docs).toHaveLength(2);
    expect(docs[0]?.title).toBe('A');
  });

  it('skips records that fail to normalize and keeps the rest', async () => {
    const strategy: IngestionStrategy = {
      datasource: 'fake',
      async fetch(): Promise<RawData[]> {
        return [{ title: 'ok' }, { bad: true }];
      },
      normalize(data: RawData) {
        if (!('title' in data)) {
          throw new Error('missing title');
        }
        return { datasetId, title: String(data['title']), content: null };
      },
    };

    const docs = await new Ingester(strategy).run();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe('ok');
  });

  it('wraps a failed fetch in DatasourceError', async () => {
    const strategy: IngestionStrategy = {
      datasource: 'fake',
      async fetch(): Promise<RawData[]> {
        throw new Error('boom');
      },
      normalize: () => ({ datasetId }),
    };

    await expect(new Ingester(strategy).run()).rejects.toThrow(DatasourceError);
  });

  it('throws TimeoutError when fetch exceeds the configured timeout', async () => {
    const strategy: IngestionStrategy = {
      datasource: 'fake',
      async fetch(): Promise<RawData[]> {
        return new Promise(() => {});
      },
      normalize: () => ({ datasetId }),
    };

    await expect(new Ingester(strategy, { timeoutMs: 50 }).run()).rejects.toThrow(TimeoutError);
  });

  it('throws IngestionError when every record fails to normalize', async () => {
    const strategy: IngestionStrategy = {
      datasource: 'fake',
      async fetch(): Promise<RawData[]> {
        return [{ id: 1 }];
      },
      normalize: () => {
        throw new Error('always fails');
      },
    };

    await expect(new Ingester(strategy).run()).rejects.toThrow(IngestionError);
  });
});
