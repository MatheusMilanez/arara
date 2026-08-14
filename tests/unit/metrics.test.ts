import { describe, expect, it } from 'vitest';
import {
  documentsIngestedTotal,
  ingestDurationSeconds,
  ingestErrorsTotal,
  register,
} from '../../src/observability/metrics.js';
import { Ingester } from '../../src/services/ingester/index.js';
import type { IngestionStrategy, RawData } from '../../src/services/ingester/types.js';

const datasetId = '00000000-0000-0000-0000-000000000000';

async function counterValue(metric: typeof ingestErrorsTotal, datasource: string): Promise<number> {
  const data = await metric.get();
  return data.values.find((v) => v.labels['datasource'] === datasource)?.value ?? 0;
}

async function histogramCount(datasource: string): Promise<number> {
  const data = await ingestDurationSeconds.get();
  return data.values.find((v) => v.metricName?.endsWith('_count') && v.labels['datasource'] === datasource)?.value ?? 0;
}

describe('Ingester metrics', () => {
  // label único por teste evita que os contadores acumulados de outros
  // testes (métricas são singletons de módulo) contaminem a asserção
  it('records duration and document count for a successful run', async () => {
    const datasource = 'fake-metrics-ok';
    const strategy: IngestionStrategy = {
      datasource,
      async fetch(): Promise<RawData[]> {
        return [{ title: 'A' }, { title: 'B' }];
      },
      normalize: (data) => ({ datasetId, title: String(data['title']), content: null }),
    };

    await new Ingester(strategy).run();

    expect(await counterValue(documentsIngestedTotal, datasource)).toBe(2);
    expect(await histogramCount(datasource)).toBe(1);
  });

  it('counts one error per record that fails to normalize', async () => {
    const datasource = 'fake-metrics-partial-fail';
    const strategy: IngestionStrategy = {
      datasource,
      async fetch(): Promise<RawData[]> {
        return [{ ok: true }, { bad: true }];
      },
      normalize: (data) => {
        if (!('ok' in data)) {
          throw new Error('bad record');
        }
        return { datasetId, title: 'ok', content: null };
      },
    };

    await new Ingester(strategy).run();

    expect(await counterValue(ingestErrorsTotal, datasource)).toBe(1);
    expect(await counterValue(documentsIngestedTotal, datasource)).toBe(1);
  });

  it('counts an error when the whole fetch fails', async () => {
    const datasource = 'fake-metrics-fetch-fail';
    const strategy: IngestionStrategy = {
      datasource,
      async fetch(): Promise<RawData[]> {
        throw new Error('boom');
      },
      normalize: () => ({ datasetId }),
    };

    await expect(new Ingester(strategy).run()).rejects.toThrow();

    expect(await counterValue(ingestErrorsTotal, datasource)).toBe(1);
  });
});

describe('database_pool_connections gauge', () => {
  it('reflects the live pool state at scrape time', async () => {
    const text = await register.metrics();
    expect(text).toContain('# HELP database_pool_connections');
    expect(text).toMatch(/database_pool_connections\{state="total"\} \d/);
  });
});
