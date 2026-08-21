import cors from '@fastify/cors';
import Fastify from 'fastify';
import { datasetsRoutes } from './api/routes/datasets.js';
import { healthRoutes } from './api/routes/health.js';
import { metricsRoutes } from './api/routes/metrics.js';
import { searchRoutes } from './api/routes/search.js';
import { logger } from './observability/logger.js';

// allowlist explícita via env, nunca origin: true (reflete qualquer origem) —
// a API não tem autenticação hoje, mas allowlist é o hábito correto de
// qualquer forma. Sem FRONTEND_ORIGIN configurada, a lista fica vazia e todo
// pedido cross-origin de navegador é bloqueado (falha fechada, não aberta).
function parseAllowedOrigins(): string[] {
  return (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

// eslint-error-de-propósito: variável não usada, só pra provar que a branch
// protection bloqueia merge com CI vermelho (ARARA-803) — nunca mergear isto
const _verificacaoDeliberada = 1;

export async function buildApp() {
  const app = Fastify({ loggerInstance: logger });

  await app.register(cors, { origin: parseAllowedOrigins() });

  app.get('/', async () => {
    return { ok: true, service: 'arara' };
  });

  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.register(datasetsRoutes, { prefix: '/api/v1' });
  await app.register(searchRoutes, { prefix: '/api/v1' });
  // sem prefixo /api/v1 de propósito: scrapers do Prometheus esperam /metrics
  // na raiz por convenção, não é um endpoint de negócio versionado
  await app.register(metricsRoutes);

  return app;
}
