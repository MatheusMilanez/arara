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

const DATASOURCE = 'inep-escolas-2025';
const ZIP_URL = 'https://download.inep.gov.br/dados_abertos/microdados_censo_escolar_2025_.zip';
const MAX_ATTEMPTS = 3;
// o zip completo passa de 500MB (traz matrículas, turmas, docentes — só
// usamos o CSV de escolas); um timeout padrão (30s) não é suficiente
const REQUEST_TIMEOUT_MS = 300_000;
// o nome do arquivo dentro do zip muda de ano pra ano (ex: "_V2", "_v3"),
// mas sempre começa assim — casar pelo prefixo é mais robusto que o caminho
// completo (que também muda: "microdados_censo_escolar_2025_v2/dados/...")
const SCHOOL_FILE_PREFIX = 'Tabela_Escola';
const ATIVA = '1'; // TP_SITUACAO_FUNCIONAMENTO — confirmado no dicionário de dados do INEP

const DEPENDENCIA_LABELS: Record<string, string> = {
  '1': 'Federal',
  '2': 'Estadual',
  '3': 'Municipal',
  '4': 'Privada',
};

const LOCALIZACAO_LABELS: Record<string, string> = {
  '1': 'Urbana',
  '2': 'Rural',
};

interface EscolaRaw {
  CO_ENTIDADE?: string;
  NO_ENTIDADE?: string;
  NO_REGIAO?: string;
  SG_UF?: string;
  NO_UF?: string;
  NO_MUNICIPIO?: string;
  CO_MUNICIPIO?: string;
  TP_DEPENDENCIA?: string;
  TP_LOCALIZACAO?: string;
  TP_SITUACAO_FUNCIONAMENTO?: string;
  NU_ANO_CENSO?: string;
}

// só as colunas que a gente usa — a tabela real tem 290 colunas, e manter
// as outras ~280 por linha (180 mil linhas) seria memória jogada fora
const NEEDED_COLUMNS = new Set<string>([
  'CO_ENTIDADE',
  'NO_ENTIDADE',
  'NO_REGIAO',
  'SG_UF',
  'NO_UF',
  'NO_MUNICIPIO',
  'CO_MUNICIPIO',
  'TP_DEPENDENCIA',
  'TP_LOCALIZACAO',
  'TP_SITUACAO_FUNCIONAMENTO',
  'NU_ANO_CENSO',
]);

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
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

function extractActiveSchoolRows(zipBuffer: Buffer): RawData[] {
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntries().find((e) => e.entryName.split('/').pop()?.startsWith(SCHOOL_FILE_PREFIX));

  if (!entry) {
    throw new Error(`Arquivo de escolas não encontrado no zip (prefixo esperado: ${SCHOOL_FILE_PREFIX})`);
  }

  // Latin-1 (ISO-8859-1), igual ao padrão de todo dado aberto do governo
  const text = entry.getData().toString('latin1');
  const records = parse(text, {
    delimiter: ';',
    skip_empty_lines: true,
    trim: true,
    columns: (header: string[]) => header.map((name) => (NEEDED_COLUMNS.has(name) ? name : undefined)),
  }) as RawData[];

  const active = records.filter((r) => r['TP_SITUACAO_FUNCIONAMENTO'] === ATIVA);
  logger.info(
    { component: DATASOURCE, file: entry.entryName, total: records.length, ativas: active.length },
    'Arquivo de escolas processado',
  );

  return active;
}

export function makeStrategy(datasetId: string): IngestionStrategy {
  return {
    datasource: DATASOURCE,

    async fetch(): Promise<RawData[]> {
      const zipBuffer = await fetchZipWithRetry();
      return extractActiveSchoolRows(zipBuffer);
    },

    normalize(data: RawData) {
      const raw = data as EscolaRaw;
      const entidadeId = nonEmpty(raw.CO_ENTIDADE);
      const nome = nonEmpty(raw.NO_ENTIDADE);

      if (entidadeId === null || nome === null) {
        throw new Error('Missing required fields: CO_ENTIDADE, NO_ENTIDADE');
      }

      const uf = nonEmpty(raw.SG_UF);
      const municipio = nonEmpty(raw.NO_MUNICIPIO);
      const regiao = nonEmpty(raw.NO_REGIAO);
      const dependenciaCodigo = nonEmpty(raw.TP_DEPENDENCIA);
      const localizacaoCodigo = nonEmpty(raw.TP_LOCALIZACAO);
      const dependencia = dependenciaCodigo ? (DEPENDENCIA_LABELS[dependenciaCodigo] ?? null) : null;
      const localizacao = localizacaoCodigo ? (LOCALIZACAO_LABELS[localizacaoCodigo] ?? null) : null;

      const title = uf ? `${nome} - ${uf}` : nome;

      const contentParts = [
        municipio ? `Escola em ${municipio}${uf ? ` (${uf})` : ''}` : uf ? `Escola no estado de ${uf}` : 'Escola',
        dependencia ? `rede ${dependencia.toLowerCase()}` : null,
        localizacao ? `área ${localizacao.toLowerCase()}` : null,
      ].filter((part): part is string => part !== null);

      return {
        datasetId,
        title,
        content: `${contentParts.join(', ')}.`,
        metadata: {
          entidadeId,
          uf,
          municipio,
          regiao,
          dependencia,
          localizacao,
          anoCenso: nonEmpty(raw.NU_ANO_CENSO),
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
      name: 'Escolas em Atividade (Censo Escolar 2025, INEP)',
      description:
        'Escolas de educação básica em atividade no Brasil, via microdados do Censo Escolar 2025 do INEP. ' +
        'Escolas paralisadas ou extintas não são incluídas.',
      metadata: { anoCenso: '2025', fonte: ZIP_URL },
    });
  }

  // o fetch + parse de ~180 mil linhas leva mais que os 30s padrão
  const documents = await new Ingester(makeStrategy(dataset.id), { timeoutMs: 300_000 }).run();

  // full resync: mesmo motivo do IBGE e do TSE — sem chave natural pra
  // upsert (o id do INEP vive em `metadata`, não numa coluna)
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

// só roda sozinho quando o arquivo é executado diretamente (tsx .../inepEscolas.ts),
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
