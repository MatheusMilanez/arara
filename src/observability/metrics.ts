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
