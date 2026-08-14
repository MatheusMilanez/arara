import { pathToFileURL } from 'node:url';
import { closePool } from '../../../database/client.js';
import {
  deleteDocumentsByDataset,
  getDatasetBySource,
  insertDataset,
  insertDocument,
  markDatasetIndexed,
} from '../../../database/queries.js';
import { logger } from '../../../observability/logger.js';
import { Ingester } from '../index.js';
import type { IngestionStrategy, RawData } from '../types.js';

const DATASOURCE = 'ibge-municipios';
const BASE_URL = 'https://servicodados.ibge.gov.br/api/v1/localidades';
const REQUEST_DELAY_MS = 150;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

// IBGE's locality API is queried per state rather than with limit/offset —
// this is the closest real-world equivalent to "pagination" it offers.
const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

interface MunicipioRaw {
  id?: unknown;
  nome?: unknown;
  microrregiao?: {
    mesorregiao?: {
      UF?: {
        sigla?: unknown;
        nome?: unknown;
        regiao?: { nome?: unknown };
      };
    };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, attempt = 1): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) {
      throw err;
    }
    const backoffMs = 500 * 2 ** (attempt - 1);
    logger.warn(
      { component: DATASOURCE, url, attempt, backoffMs, error: err instanceof Error ? err.message : String(err) },
      'Request failed, retrying with backoff',
    );
    await sleep(backoffMs);
    return fetchWithRetry(url, attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

export function makeStrategy(datasetId: string): IngestionStrategy {
  return {
    datasource: DATASOURCE,

    async fetch(): Promise<RawData[]> {
      const all: RawData[] = [];

      for (const [index, uf] of UFS.entries()) {
        try {
          const res = await fetchWithRetry(`${BASE_URL}/estados/${uf}/municipios`);
          const municipios = (await res.json()) as RawData[];
          all.push(...municipios);
          logger.info(
            { component: DATASOURCE, uf, count: municipios.length, page: index + 1, totalPages: UFS.length },
            'Fetched state',
          );
        } catch (err) {
          logger.error(
            { component: DATASOURCE, uf, error: err instanceof Error ? err.message : String(err) },
            'API down for this state, skipping and continuing',
          );
        }
        await sleep(REQUEST_DELAY_MS);
      }

      return all;
    },

    normalize(data: RawData) {
      const raw = data as MunicipioRaw;
      if (typeof raw.id !== 'number' || typeof raw.nome !== 'string' || raw.nome.length === 0) {
        throw new Error('Missing required fields: id, nome');
      }

      const uf = raw.microrregiao?.mesorregiao?.UF;
      const ufSigla = typeof uf?.sigla === 'string' ? uf.sigla : null;
      const ufNome = typeof uf?.nome === 'string' ? uf.nome : null;
      const regiaoNome = typeof uf?.regiao?.nome === 'string' ? uf.regiao.nome : null;

      return {
        datasetId,
        title: ufSigla ? `${raw.nome} - ${ufSigla}` : raw.nome,
        content:
          ufNome !== null
            ? `Município de ${raw.nome}, estado de ${ufNome} (${ufSigla}), região ${regiaoNome ?? 'não informada'}.`
            : raw.nome,
        metadata: { ibgeId: raw.id, uf: ufSigla, regiao: regiaoNome },
        sourceUrl: `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${raw.id}`,
      };
    },
  };
}

export async function run(): Promise<void> {
  let dataset = await getDatasetBySource(DATASOURCE);
  if (!dataset) {
    dataset = await insertDataset({
      source: DATASOURCE,
      name: 'Municípios do Brasil (IBGE)',
      description: 'Lista de municípios brasileiros por UF, via API de Localidades do IBGE.',
    });
  }

  const documents = await new Ingester(makeStrategy(dataset.id)).run();

  // Full resync: this datasource has no natural unique key to upsert on
  // (IBGE municipio IDs live in `metadata`, not a column), so re-running
  // this script clears the previous batch before reloading instead of
  // appending duplicates on top of it.
  await deleteDocumentsByDataset(dataset.id);

  const BATCH_SIZE = 50;
  let inserted = 0;
  let failed = 0;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((doc) => insertDocument(doc)));

    for (const result of results) {
      if (result.status === 'fulfilled') {
        inserted += 1;
      } else {
        failed += 1;
        logger.error(
          { component: DATASOURCE, error: result.reason instanceof Error ? result.reason.message : String(result.reason) },
          'Failed to insert document',
        );
      }
    }
  }

  await markDatasetIndexed(dataset.id, inserted);
  logger.info({ component: DATASOURCE, inserted, failed, total: documents.length }, 'Insert finished');
}

// Only auto-run when this file is executed directly (tsx .../ibgeMunicipios.ts),
// not when it's imported by tests — importing it must not hit the network or DB.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  run()
    .catch((err: unknown) => {
      logger.error({ component: DATASOURCE, error: err instanceof Error ? err.message : String(err) }, 'Ingestion failed');
      process.exitCode = 1;
    })
    .finally(() => {
      void closePool();
    });
}
