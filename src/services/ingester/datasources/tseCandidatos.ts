import { pathToFileURL } from 'node:url';
import AdmZip from 'adm-zip';
import { parse } from 'csv-parse/sync';
import { invalidateSearchCache } from '../../../cache/searchCache.js';
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

const DATASOURCE = 'tse-candidatos-2024';
const ZIP_URL = 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2024.zip';
const MAX_ATTEMPTS = 3;
// o zip completo tem ~64MB; um timeout de rede padrão (30s) não é suficiente
const REQUEST_TIMEOUT_MS = 120_000;
const CSV_SUFFIX = '.csv';
// o TSE inclui um CSV "_BRASIL" com a soma de todos os estados — ingerir
// ele também duplicaria cada candidatura
const CONSOLIDATED_FILE_SUFFIX = '_BRASIL.csv';
// valores que o TSE usa pra "não se aplica" — tratamos como ausentes
const NULL_MARKERS = new Set(['#NULO', '#NE']);

interface CandidatoRaw {
  SQ_CANDIDATO?: string;
  NM_URNA_CANDIDATO?: string;
  DS_CARGO?: string;
  SG_PARTIDO?: string;
  SG_UF?: string;
  NM_UE?: string;
  DS_SIT_TOT_TURNO?: string;
  DS_GENERO?: string;
  DS_COR_RACA?: string;
  DS_GRAU_INSTRUCAO?: string;
  ANO_ELEICAO?: string;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || NULL_MARKERS.has(trimmed) ? null : trimmed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchZipWithRetry(attempt = 1): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(ZIP_URL, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS) {
      throw err;
    }
    const backoffMs = 500 * 2 ** (attempt - 1);
    logger.warn(
      { component: DATASOURCE, attempt, backoffMs, error: err instanceof Error ? err.message : String(err) },
      'Falha ao baixar o zip, tentando de novo com backoff',
    );
    await sleep(backoffMs);
    return fetchZipWithRetry(attempt + 1);
  } finally {
    clearTimeout(timer);
  }
}

function extractCandidateRows(zipBuffer: Buffer): RawData[] {
  const zip = new AdmZip(zipBuffer);
  const rows: RawData[] = [];

  const entries = zip
    .getEntries()
    .filter((entry) => entry.entryName.endsWith(CSV_SUFFIX) && !entry.entryName.endsWith(CONSOLIDATED_FILE_SUFFIX));

  for (const entry of entries) {
    try {
      // os arquivos do TSE vêm em Latin-1 (ISO-8859-1), não UTF-8
      const text = entry.getData().toString('latin1');
      const records = parse(text, {
        columns: true,
        delimiter: ';',
        quote: '"',
        skip_empty_lines: true,
        trim: true,
      }) as RawData[];

      rows.push(...records);
      logger.info({ component: DATASOURCE, file: entry.entryName, count: records.length }, 'Arquivo de UF processado');
    } catch (err) {
      // um CSV corrompido não pode derrubar a ingestão inteira — mesmo
      // princípio do ingester do IBGE: pula esse arquivo e segue com o resto
      logger.error(
        { component: DATASOURCE, file: entry.entryName, error: err instanceof Error ? err.message : String(err) },
        'Falha ao parsear o CSV, pulando este arquivo e seguindo com os demais',
      );
    }
  }

  return rows;
}

export function makeStrategy(datasetId: string): IngestionStrategy {
  return {
    datasource: DATASOURCE,

    async fetch(): Promise<RawData[]> {
      const zipBuffer = await fetchZipWithRetry();
      return extractCandidateRows(zipBuffer);
    },

    normalize(data: RawData) {
      const raw = data as CandidatoRaw;
      const candidatoId = nonEmpty(raw.SQ_CANDIDATO);
      const nomeUrna = nonEmpty(raw.NM_URNA_CANDIDATO);

      if (candidatoId === null || nomeUrna === null) {
        throw new Error('Missing required fields: SQ_CANDIDATO, NM_URNA_CANDIDATO');
      }

      const cargo = nonEmpty(raw.DS_CARGO);
      const partido = nonEmpty(raw.SG_PARTIDO);
      const uf = nonEmpty(raw.SG_UF);
      const municipio = nonEmpty(raw.NM_UE);
      const situacao = nonEmpty(raw.DS_SIT_TOT_TURNO);

      const title = [nomeUrna, cargo, partido && uf ? `${partido}/${uf}` : (partido ?? uf)]
        .filter((part): part is string => part !== null)
        .join(' - ');

      const contentParts = [
        cargo ? `Candidato(a) a ${cargo.toLowerCase()}` : null,
        municipio ? `em ${municipio}${uf ? ` (${uf})` : ''}` : uf ? `no estado de ${uf}` : null,
        partido ? `pelo ${partido}` : null,
        situacao ? `— situação: ${situacao.toLowerCase()}` : null,
      ].filter((part): part is string => part !== null);

      return {
        datasetId,
        title,
        content: contentParts.length > 0 ? `${contentParts.join(' ')}.` : nomeUrna,
        metadata: {
          candidatoId,
          cargo,
          partido,
          uf,
          municipio,
          situacao,
          genero: nonEmpty(raw.DS_GENERO),
          corRaca: nonEmpty(raw.DS_COR_RACA),
          grauInstrucao: nonEmpty(raw.DS_GRAU_INSTRUCAO),
          anoEleicao: nonEmpty(raw.ANO_ELEICAO),
        },
        sourceUrl: null,
      };
    },
  };
}

export async function run(): Promise<void> {
  let dataset = await getDatasetBySource(DATASOURCE);
  if (!dataset) {
    dataset = await insertDataset({
      source: DATASOURCE,
      name: 'Candidatos e Candidatas — Eleições Municipais 2024 (TSE)',
      description: 'Candidaturas registradas nas eleições municipais de 2024, via Portal de Dados Abertos do TSE.',
      // registrado de forma estruturada (não só no nome/descrição em texto livre)
      // pra dar pra filtrar o dataset por ano sem parsear string
      metadata: { anoEleicao: '2024', fonte: ZIP_URL },
    });
  }

  // o zip é grande e o parsing de ~470 mil linhas leva mais que os 30s padrão
  const documents = await new Ingester(makeStrategy(dataset.id), { timeoutMs: 180_000 }).run();

  // full resync: assim como no ingester do IBGE, não há chave natural pra
  // fazer upsert (o id do TSE vive em `metadata`, não numa coluna), então
  // reexecutar limpa o lote anterior antes de recarregar
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
          'Falha ao inserir documento',
        );
      }
    }

    const batchNumber = i / BATCH_SIZE + 1;
    if (batchNumber % 100 === 0) {
      logger.info({ component: DATASOURCE, inserted, failed, total: documents.length }, 'Progresso da inserção');
    }
  }

  await markDatasetIndexed(dataset.id, inserted);
  await invalidateSearchCache();
  logger.info({ component: DATASOURCE, inserted, failed, total: documents.length }, 'Inserção finalizada');
}

// só roda sozinho quando o arquivo é executado diretamente (tsx .../tseCandidatos.ts),
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
