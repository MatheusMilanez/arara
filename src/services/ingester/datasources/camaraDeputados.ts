import { pathToFileURL } from 'node:url';
import { invalidateSearchCache } from '../../../cache/searchCache.js';
import { closePool } from '../../../database/client.js';
import {
  getDatasetBySource,
  insertDataset,
  markDatasetIndexed,
  upsertDocuments,
  type UpsertDocumentInput,
} from '../../../database/queries.js';
import { logger } from '../../../observability/logger.js';
import { Ingester } from '../index.js';
import type { IngestionStrategy, RawData } from '../types.js';

const DATASOURCE = 'camara-proposicoes';
const BASE_URL = 'https://dadosabertos.camara.leg.br/api/v2';
const REQUEST_DELAY_MS = 150;
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;
// a API devolve no máximo 100 itens por página, mesmo se um valor maior for
// pedido — descoberto testando contra a API real (ARARA-600), não documentado
const ITENS_PER_PAGE = 100;
// "todas as proposições do ano" sem filtro de tipo é uma ordem de grandeza
// maior do que parece (50-100 mil, incluindo tipos administrativos como MSC
// e PROC que não interessam pra busca) — descoberto na prática tentando
// ingerir sem filtro, não uma estimativa. PL e PEC são os tipos que
// interessam pra v1: projetos de lei e emendas constitucionais de verdade.
const TIPOS = ['PL', 'PEC'];

interface ProposicaoRaw {
  id?: unknown;
  siglaTipo?: unknown;
  numero?: unknown;
  ano?: unknown;
  ementa?: unknown;
  dataApresentacao?: unknown;
}

interface DateWindow {
  inicio: string;
  fim: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ARARA-600: a API rejeita com 400 se a diferença entre dataApresentacaoInicio
// e dataApresentacaoFim passar de 3 meses ("A diferença entre as datas não
// pode ser maior que 3 meses") — não é documentado, só descoberto testando.
// Gera janelas trimestrais do ano corrente, até hoje (não busca trimestre
// futuro, e corta o trimestre corrente na data de hoje).
function buildQuarterWindows(year: number, today: Date): DateWindow[] {
  const quarterStarts = [0, 3, 6, 9]; // meses (0-indexed): jan, abr, jul, out
  const windows: DateWindow[] = [];

  for (const startMonth of quarterStarts) {
    const start = new Date(Date.UTC(year, startMonth, 1));
    if (start > today) break;

    const naturalEnd = new Date(Date.UTC(year, startMonth + 3, 0)); // último dia do trimestre
    const end = naturalEnd > today ? today : naturalEnd;

    windows.push({ inicio: toIsoDate(start), fim: toIsoDate(end) });
  }

  return windows;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, attempt = 1): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
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

async function fetchWindow(window: DateWindow, tipo: string): Promise<RawData[]> {
  const all: RawData[] = [];
  let pagina = 1;

  for (;;) {
    const url =
      `${BASE_URL}/proposicoes?siglaTipo=${tipo}` +
      `&dataApresentacaoInicio=${window.inicio}&dataApresentacaoFim=${window.fim}` +
      `&itens=${ITENS_PER_PAGE}&pagina=${pagina}&ordem=ASC&ordenarPor=id`;

    const res = await fetchWithRetry(url);
    const body = (await res.json()) as { dados?: RawData[] };
    const page = body.dados ?? [];
    all.push(...page);

    logger.info(
      { component: DATASOURCE, ...window, tipo, pagina, count: page.length },
      'Fetched page',
    );

    if (page.length < ITENS_PER_PAGE) break;
    pagina += 1;
    await sleep(REQUEST_DELAY_MS);
  }

  return all;
}

export function makeStrategy(datasetId: string): IngestionStrategy {
  return {
    datasource: DATASOURCE,

    async fetch(): Promise<RawData[]> {
      const today = new Date();
      const windows = buildQuarterWindows(today.getUTCFullYear(), today);
      const all: RawData[] = [];

      for (const tipo of TIPOS) {
        for (const window of windows) {
          try {
            all.push(...(await fetchWindow(window, tipo)));
          } catch (err) {
            // uma janela indisponível não pode derrubar as outras — mesmo
            // princípio dos demais ingesters (ex: IBGE por UF)
            logger.error(
              { component: DATASOURCE, ...window, tipo, error: err instanceof Error ? err.message : String(err) },
              'Failed to fetch window, skipping and continuing',
            );
          }
          await sleep(REQUEST_DELAY_MS);
        }
      }

      return all;
    },

    normalize(data: RawData) {
      const raw = data as ProposicaoRaw;
      if (typeof raw.id !== 'number' || typeof raw.ementa !== 'string' || raw.ementa.length === 0) {
        throw new Error('Missing required fields: id, ementa');
      }

      const siglaTipo = typeof raw.siglaTipo === 'string' ? raw.siglaTipo : null;
      const numero = typeof raw.numero === 'number' ? raw.numero : null;
      const ano = typeof raw.ano === 'number' ? raw.ano : null;
      const dataApresentacao = typeof raw.dataApresentacao === 'string' ? raw.dataApresentacao : null;

      const title =
        siglaTipo && numero && ano ? `${siglaTipo} ${numero}/${ano}` : `Proposição ${String(raw.id)}`;

      return {
        datasetId,
        externalId: String(raw.id),
        title,
        content: raw.ementa,
        metadata: { siglaTipo, numero, ano, dataApresentacao },
        sourceUrl: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${String(raw.id)}`,
      };
    },
  };
}

export async function run(): Promise<void> {
  let dataset = await getDatasetBySource(DATASOURCE);
  if (!dataset) {
    dataset = await insertDataset({
      source: DATASOURCE,
      name: 'Proposições Legislativas (Câmara dos Deputados)',
      description:
        'Projetos de Lei (PL) e Propostas de Emenda à Constituição (PEC) apresentados na Câmara dos ' +
        'Deputados no ano corrente, via API de Dados Abertos.',
    });
  }

  // paginação em janelas trimestrais, 2 tipos, passa longe do timeout padrão
  // de 30s — mesmo problema que o TSE já teve com o zip grande, mesma solução
  const documents = await new Ingester(makeStrategy(dataset.id), { timeoutMs: 120_000 }).run();
  logger.info({ component: DATASOURCE, fetched: documents.length }, 'Fetch concluído, iniciando upsert');

  // ARARA-600/ADR-0002: diferente do IBGE/TSE/INEP, esta fonte tem chave
  // natural real (o id da proposição) — upsertDocuments() em vez do padrão
  // antigo de deletar tudo e reinserir com insertDocument() em loop. Reexecutar
  // atualiza proposições já conhecidas e insere as novas, sem duplicar nada.
  const BATCH_SIZE = 200;
  let upserted = 0;
  let failed = 0;

  for (let i = 0; i < documents.length; i += BATCH_SIZE) {
    const batch = documents.slice(i, i + BATCH_SIZE);
    const withExternalId = batch.filter((doc): doc is UpsertDocumentInput => {
      if (typeof doc.externalId !== 'string') {
        logger.warn({ component: DATASOURCE, datasetId: doc.datasetId }, 'Document missing externalId, skipping');
        return false;
      }
      return true;
    });

    try {
      await upsertDocuments(withExternalId);
      upserted += withExternalId.length;
    } catch (err) {
      failed += withExternalId.length;
      logger.error(
        { component: DATASOURCE, error: err instanceof Error ? err.message : String(err) },
        'Failed to upsert batch',
      );
    }

    logger.info({ component: DATASOURCE, upserted, failed, total: documents.length }, 'Upsert progress');
  }

  await markDatasetIndexed(dataset.id, upserted);
  await invalidateSearchCache();
  logger.info({ component: DATASOURCE, upserted, failed, total: documents.length }, 'Upsert finished');
}

// só roda sozinho quando o arquivo é executado diretamente (tsx .../camaraDeputados.ts),
// não quando é importado pelos testes — importar não pode disparar rede nem banco
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  run()
    .catch((err: unknown) => {
      logger.error({ component: DATASOURCE, error: err instanceof Error ? err.message : String(err) }, 'Ingestão falhou');
      process.exitCode = 1;
    })
    .finally(() => {
      void closePool();
    });
}
