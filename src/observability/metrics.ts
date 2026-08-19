import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';
import { redisClient } from '../cache/redis.js';
import { pool } from '../database/client.js';
import { logger } from './logger.js';

export const register = new Registry();

// CPU, memória (RSS/heap), event loop lag, GC — usados pelo dashboard
// "System" (ARARA-320). Disco fica de fora: exigiria um exporter à parte
// (node_exporter) rodando no host, fora do escopo deste projeto.
collectDefaultMetrics({ register });

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

// ARARA-310: buckets em ms, não segundos — a latência de busca (cache hit
// principalmente) fica na casa de 1-100ms, e histogram_quantile em cima de
// buckets em segundos ficaria com resolução ruim nessa faixa
export const searchLatencyMs = new Histogram({
  name: 'search_latency_ms',
  help: 'Latência da rota de busca, em milissegundos, por resultado de cache (hit/miss)',
  labelNames: ['cache'] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500],
  registers: [register],
});

// collect() aqui é async — diferente do gauge do pool acima, ler o uso de
// memória do Redis exige um round-trip (INFO). register.metrics() já dá
// await em cada collect(), então isso é seguro (ver ARARA-310).
new Gauge({
  name: 'redis_memory_bytes',
  help: 'Memória usada pelo Redis, em bytes (used_memory do INFO memory)',
  registers: [register],
  async collect() {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      const info = await redisClient.info('memory');
      const match = info.match(/^used_memory:(\d+)/m);
      this.set(match ? Number(match[1]) : 0);
    } catch (err) {
      logger.warn(
        { component: 'metrics', error: err instanceof Error ? err.message : String(err) },
        'Falha ao ler uso de memória do Redis',
      );
      this.set(0);
    }
  },
});
