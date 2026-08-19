# ARARA-400: Resultado do Load Test

## Como rodar

Pré-requisitos: `docker-compose up -d` (Postgres + Redis no mínimo) e a API rodando
(`npm run dev`) com dado real ingerido (`npm run ingest:ibge`, `ingest:inep` ou
`ingest:tse` — o teste busca por termos genéricos em português, então qualquer um serve).

```bash
docker run --rm --add-host=host.docker.internal:host-gateway \
  -v "$(pwd -W)/tests/load:/scripts" \
  -e BASE_URL=http://host.docker.internal:3000 \
  grafana/k6 run /scripts/search.js
```

No Windows com Git Bash, o path do volume/script pode ser reescrito incorretamente pelo
MSYS (`/scripts/search.js` vira `C:/Program Files/Git/scripts/search.js`) — se isso
acontecer, prefixe o comando com `MSYS_NO_PATHCONV=1`.

## Meta do ticket
- 500 req/s sustentado
- p99 de latência < 100ms
- Taxa de erro < 1%

## Resultado real (2026-08-19)

| Métrica | Meta | Medido |
|---|---|---|
| Throughput sustentado | 500 req/s | **282 req/s** (`http_reqs`) |
| p99 de latência | < 100ms | **5,69s** |
| p95 de latência | — | 5,22s |
| Taxa de erro | < 1% | **8,88%** (7.522 / 84.672) |
| Iterações descartadas | 0 | 65.335 (k6 não conseguiu abrir VUs suficientes pra sustentar 500/s) |

Os três thresholds configurados em `search.js` (`http_req_duration`, `http_req_failed`,
`dropped_iterations`) falharam. **A meta do ticket não foi atingida.**

## Hipótese da causa raiz
O pool de conexões do Postgres tem `max: 20` (`src/database/client.ts`, decisão do
ADR-0003, dimensionado pro cenário de ingestão paralela do M2 — não pra 500 req/s de
busca). Com `connectionTimeoutMillis: 5000`, uma requisição que não consegue vaga no pool
em 5s estoura erro. O p95 observado (5,22s) fica bem próximo desse timeout, o que sugere
que o pool — não a query em si, nem o Redis — é o teto real aqui.

**Não confirmamos essa hipótese experimentalmente** (não reexecutamos o teste com
`POOL_MAX` maior). Fica como próxima ação, não como conclusão.

## Confundidor conhecido
Este teste rodou numa máquina de desenvolvimento local, com Postgres, Redis, Prometheus,
Grafana e o próprio container do k6 todos disputando CPU/rede ao mesmo tempo — não é um
ambiente isolado dedicado. Os números acima são um piso de capacidade desta máquina nessas
condições, não uma medição de capacidade de produção em hardware dedicado.

## Ação de acompanhamento
Se a rota de busca precisar sustentar tráfego real nessa ordem de grandeza, os próximos
passos, em ordem de esforço:
1. Reexecutar o teste com `POOL_MAX` maior, isolado (sem Prometheus/Grafana/k6 competindo
   no mesmo host), pra confirmar ou descartar a hipótese do pool antes de qualquer mudança
   de configuração em produção.
2. Se o pool for confirmado como gargalo, dimensionar `POOL_MAX` pro throughput alvo, não
   só pro cenário de ingestão paralela do ADR-0003.
