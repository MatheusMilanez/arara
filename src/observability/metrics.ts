import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { pool } from '../database/client.js';

export const register = new Registry();

export const ingestDurationSeconds = new Histogram({
  name: 'ingest_duration_seconds',
  help: 'Tempo de execução de uma ingestão (fetch + normalize), em segundos',
  labelNames: ['datasource'] as const,
  registers: [register],
});

export const ingestErrorsTotal = new Counter({
  name: 'ingest_errors_total',
  help: 'Total de erros durante a ingestão (registros que falharam ao normalizar, ou a fonte inteira indisponível)',
  labelNames: ['datasource'] as const,
  registers: [register],
});

export const documentsIngestedTotal = new Counter({
  name: 'documents_ingested_total',
  help: 'Total de documentos normalizados com sucesso por uma ingestão',
  labelNames: ['datasource'] as const,
  registers: [register],
});

// `collect` roda a cada scrape — reflete o estado atual do pool, não precisa
// de um timer separado atualizando isso em background
new Gauge({
  name: 'database_pool_connections',
  help: 'Conexões do pool do Postgres, por estado',
  labelNames: ['state'] as const,
  registers: [register],
  collect() {
    this.set({ state: 'total' }, pool.totalCount);
    this.set({ state: 'idle' }, pool.idleCount);
    this.set({ state: 'waiting' }, pool.waitingCount);
  },
});

// ARARA-300: contadores simples em memória — não usam prom-client Counter
// porque o gauge abaixo precisa ler os dois valores de forma síncrona no
// collect(); ler outro metric via registry ali seria mais complicado à toa
let searchCacheHits = 0;
let searchCacheMisses = 0;

export function recordSearchCacheHit(): void {
  searchCacheHits += 1;
}

export function recordSearchCacheMiss(): void {
  searchCacheMisses += 1;
}

new Gauge({
  name: 'search_cache_hit_ratio',
  help: 'Proporção de buscas atendidas pelo cache Redis (hits / (hits + misses)) desde o boot',
  registers: [register],
  collect() {
    const total = searchCacheHits + searchCacheMisses;
    this.set(total === 0 ? 0 : searchCacheHits / total);
  },
});
