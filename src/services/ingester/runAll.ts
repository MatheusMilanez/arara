import { pathToFileURL } from 'node:url';
import { closePool } from '../../database/client.js';
import { logger } from '../../observability/logger.js';
import { run as runIbge } from './datasources/ibgeMunicipios.js';
import { run as runInep } from './datasources/inepEscolas.js';
import { run as runTse } from './datasources/tseCandidatos.js';

interface Datasource {
  name: string;
  run: () => Promise<void>;
}

const DATASOURCES: Datasource[] = [
  { name: 'ibge-municipios', run: runIbge },
  { name: 'tse-candidatos-2024', run: runTse },
  { name: 'inep-escolas-2025', run: runInep },
];

// Promise.allSettled (não Promise.all) de propósito: uma fonte falhando não
// pode derrubar as outras duas, que já podem ter terminado ou estar no meio
// da ingestão quando isso acontece
export async function runAll(): Promise<{ succeeded: string[]; failed: string[] }> {
  const start = performance.now();
  logger.info(
    { component: 'ingest-all', datasources: DATASOURCES.map((d) => d.name) },
    'Iniciando ingestão paralela',
  );

  const results = await Promise.allSettled(DATASOURCES.map((d) => d.run()));

  const succeeded: string[] = [];
  const failed: string[] = [];

  results.forEach((result, index) => {
    const datasource = DATASOURCES[index];
    if (datasource === undefined) return;

    if (result.status === 'fulfilled') {
      succeeded.push(datasource.name);
      logger.info({ component: 'ingest-all', datasource: datasource.name }, 'Ingestão concluída');
    } else {
      failed.push(datasource.name);
      logger.error(
        {
          component: 'ingest-all',
          datasource: datasource.name,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        },
        'Ingestão falhou',
      );
    }
  });

  const durationMs = Math.round(performance.now() - start);
  logger.info(
    { component: 'ingest-all', succeeded, failed, durationMs },
    'Ingestão paralela finalizada',
  );

  return { succeeded, failed };
}

// só roda sozinho quando o arquivo é executado diretamente (tsx .../runAll.ts),
// não quando é importado pelos testes
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runAll()
    .then(({ failed }) => {
      if (failed.length > 0) {
        process.exitCode = 1;
      }
    })
    .catch((err: unknown) => {
      logger.error(
        { component: 'ingest-all', error: err instanceof Error ? err.message : String(err) },
        'Ingestão paralela falhou de forma inesperada',
      );
      process.exitCode = 1;
    })
    .finally(() => {
      void closePool();
    });
}
