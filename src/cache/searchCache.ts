import { logger } from '../observability/logger.js';
import { redisClient } from './redis.js';

export interface SearchCacheClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  incr(key: string): Promise<number>;
}

export interface SearchCacheKeyParams {
  q: string;
  limit: number;
  offset: number;
  datasetId?: string;
}

const GENERATION_KEY = 'search:generation';
const TTL_SECONDS = 60 * 60; // 1h, conforme o ticket (ARARA-300)

async function ensureConnected(client: SearchCacheClient): Promise<void> {
  if (!client.isOpen) {
    await client.connect();
  }
}

async function currentGeneration(client: SearchCacheClient): Promise<number> {
  const raw = await client.get(GENERATION_KEY);
  return raw ? Number(raw) : 0;
}

// inclui datasetId na chave — sem isso, uma busca filtrada por dataset e uma
// sem filtro, com o mesmo texto/limit/offset, colidiriam na mesma entrada de
// cache e uma devolveria o resultado errado pra outra
function buildKey(params: SearchCacheKeyParams, generation: number): string {
  return `search:v${generation}:${params.q}:${params.limit}:${params.offset}:${params.datasetId ?? '_'}`;
}

// cache-aside com fallback: qualquer erro do Redis (fora do ar, timeout) faz
// a busca cair pro Postgres em vez de derrubar a requisição — é o requisito
// "If Redis down, use database" do ticket
export async function getCachedSearch<T>(
  params: SearchCacheKeyParams,
  client: SearchCacheClient = redisClient,
): Promise<T | null> {
  try {
    await ensureConnected(client);
    const generation = await currentGeneration(client);
    const raw = await client.get(buildKey(params, generation));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    logger.warn(
      { component: 'search-cache', error: err instanceof Error ? err.message : String(err) },
      'Falha ao ler cache de busca, seguindo direto pro banco',
    );
    return null;
  }
}

export async function setCachedSearch(
  params: SearchCacheKeyParams,
  value: unknown,
  client: SearchCacheClient = redisClient,
): Promise<void> {
  try {
    await ensureConnected(client);
    const generation = await currentGeneration(client);
    await client.set(buildKey(params, generation), JSON.stringify(value), { EX: TTL_SECONDS });
  } catch (err) {
    logger.warn(
      { component: 'search-cache', error: err instanceof Error ? err.message : String(err) },
      'Falha ao gravar cache de busca — busca segue funcionando sem cache',
    );
  }
}

// invalidação por geração: incrementar é O(1) e não precisa varrer o Redis
// procurando toda chave `search:*` pra apagar uma por uma (SCAN+DEL). Chaves
// da geração antiga simplesmente nunca mais são lidas, e expiram sozinhas
// pelo TTL — ninguém precisa limpar nada ativamente.
export async function invalidateSearchCache(client: SearchCacheClient = redisClient): Promise<void> {
  try {
    await ensureConnected(client);
    await client.incr(GENERATION_KEY);
  } catch (err) {
    logger.warn(
      { component: 'search-cache', error: err instanceof Error ? err.message : String(err) },
      'Falha ao invalidar cache de busca',
    );
  }
}
