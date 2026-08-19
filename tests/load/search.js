import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

// ARARA-400: aponta pra host.docker.internal, não localhost — este script
// roda dentro do container do k6 (ver docs/RUNBOOK.md), então "localhost"
// seria o próprio container, não a API rodando no host.
const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3000';

// termos comuns o suficiente pra aparecer em nomes de município reais
// (ingeridos via `npm run ingest:ibge`), garantindo uma mistura de cache
// hit (termo repetido entre VUs) e miss (primeira vez que aquele termo
// aparece) — busca contra um termo que nunca bate em nada não prova nada
// sobre latência real do caminho feliz.
const TERMS = ['santa', 'porto', 'novo', 'rio', 'grande', 'vitoria', 'boa vista', 'sao', 'nova', 'serra'];

const errorRate = new Rate('errors');

// mira o throughput diretamente (constant-arrival-rate), em vez de "N VUs
// por M minutos" — com VUs fixos, req/s real depende de quão rápido cada
// resposta volta, não é algo que se trava de antemão. O critério de aceite
// do ARARA-400 é sobre req/s sustentado, então testamos req/s sustentado.
export const options = {
  scenarios: {
    search_load: {
      executor: 'constant-arrival-rate',
      rate: 500,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 100,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<100'],
    // se isso disparar, o k6 não conseguiu abrir VUs suficientes pra
    // sustentar 500 req/s — é um limite do teste, não da API, mas precisa
    // aparecer no relatório em vez de mascarar o resultado
    dropped_iterations: ['count<1'],
  },
};

export default function () {
  const term = TERMS[Math.floor(Math.random() * TERMS.length)];
  const res = http.get(`${BASE_URL}/api/v1/search?q=${encodeURIComponent(term)}&limit=20`);

  const ok = check(res, {
    'status é 200': (r) => r.status === 200,
    'corpo tem ok: true': (r) => {
      try {
        return JSON.parse(r.body).ok === true;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
}
