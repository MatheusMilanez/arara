import type { InsertDocumentInput } from '../../database/queries.js';
import { logger } from '../../observability/logger.js';
import { DatasourceError, IngestionError, TimeoutError } from './errors.js';
import type { IngestionStrategy, RawData } from './types.js';

export { DatasourceError, IngestionError, TimeoutError } from './errors.js';
export type { IngestionStrategy, RawData } from './types.js';

export interface IngesterOptions {
  timeoutMs?: number;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, datasource: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(datasource, timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class Ingester {
  constructor(
    private readonly strategy: IngestionStrategy,
    private readonly options: IngesterOptions = {},
  ) {}

  async run(): Promise<InsertDocumentInput[]> {
    const { datasource } = this.strategy;
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const start = performance.now();

    logger.info({ component: 'ingester', datasource, operation: 'fetch' }, 'Starting ingestion');

    let rawRecords: RawData[];
    try {
      rawRecords = await withTimeout(this.strategy.fetch(), timeoutMs, datasource);
    } catch (err) {
      const wrapped =
        err instanceof TimeoutError
          ? err
          : new DatasourceError(`Failed to fetch from ${datasource}`, datasource, { cause: err });
      logger.error({ component: 'ingester', datasource, error: wrapped.message }, 'Fetch failed');
      throw wrapped;
    }

    logger.info({ component: 'ingester', datasource, rows: rawRecords.length }, 'Fetched raw records');

    const documents: InsertDocumentInput[] = [];
    let errors = 0;

    rawRecords.forEach((raw, index) => {
      try {
        const normalized = this.strategy.normalize(raw);
        documents.push(...(Array.isArray(normalized) ? normalized : [normalized]));
      } catch (err) {
        errors += 1;
        logger.warn(
          {
            component: 'ingester',
            datasource,
            index,
            error: err instanceof Error ? err.message : String(err),
          },
          'Skipped record: normalize failed',
        );
      }

      if ((index + 1) % 100 === 0) {
        logger.info(
          { component: 'ingester', datasource, progress: index + 1, total: rawRecords.length },
          'Ingestion progress',
        );
      }
    });

    const durationMs = Math.max(1, Math.round(performance.now() - start));
    logger.info(
      {
        component: 'ingester',
        datasource,
        documents: documents.length,
        errors,
        durationMs,
        recordsPerSecond: Math.round((documents.length / durationMs) * 1000),
      },
      'Ingestion finished',
    );

    if (rawRecords.length > 0 && documents.length === 0) {
      throw new IngestionError(`All ${rawRecords.length} records failed to normalize`, datasource);
    }

    return documents;
  }
}
