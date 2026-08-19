# ARARA

[![CI](https://github.com/MatheusMilanez/arara/actions/workflows/test.yml/badge.svg)](https://github.com/MatheusMilanez/arara/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Indexação aberta e distribuída de dados, documentos e recursos públicos brasileiros.

## O que é

ARARA ingere dados de fontes públicas, normaliza para um schema consistente, indexa para
busca full-text e expõe tudo via uma API REST simples.

## Problema

Dados públicos brasileiros existem, mas estão espalhados em portais e formatos diferentes,
muitas vezes sem busca decente. ARARA centraliza a ingestão dessas fontes num único índice
pesquisável, em vez de cada pessoa precisar aprender a API de cada portal.

Veja [ARARA_PROJECT_BRIEF.md](ARARA_PROJECT_BRIEF.md) para o problema completo e a motivação, e
[ARARA_TECHNICAL_SPEC.md](ARARA_TECHNICAL_SPEC.md) para a arquitetura e decisões técnicas.

## Arquitetura (visão geral)

```
Fonte externa (ex: API do IBGE)
        │  fetch() — paginado, com timeout + retry/backoff
        ▼
   Ingester (src/services/ingester)
        │  normalize() — valida e transforma pro schema interno
        ▼
   PostgreSQL (dataset + documents, trigger mantém o search_vector)
        │
        ▼
   API REST (Fastify) ──► GET /api/v1/search, /datasets, /health
```

Cada fonte de dados implementa a interface `IngestionStrategy` (`fetch` + `normalize`); a
classe `Ingester` cuida do resto — timeout, log de progresso, e não deixar um registro ruim
derrubar a ingestão inteira. Decisões arquiteturais maiores estão documentadas em
[docs/ADRs](docs/ADRs).

## Stack

- Node.js 20+ / TypeScript (strict mode)
- Fastify (API) + Zod (validação)
- PostgreSQL 14 (dados + full-text search, accent-insensitive)
- Redis (cache de buscas, invalidado por geração a cada ingestão)
- Pino (logs estruturados) + Prometheus/Grafana (métricas e dashboards)
- Vitest + testcontainers + Supertest (testes)

## Setup local

Pré-requisitos: Node.js 20+, Docker.

```bash
npm install
docker-compose up -d
cp .env.example .env
npm run migrate:up
npm run dev
```

O servidor sobe em `http://localhost:3000`. Para popular o banco com dados reais (municípios
do Brasil via API do IBGE):

```bash
npm run ingest:ibge
```

`docker-compose up -d` também sobe Prometheus (`http://localhost:9090`, raspando `/metrics`
da API a cada 15s) e Grafana (`http://localhost:3001`, login `admin`/`admin`) — os 5
dashboards (Ingestion, Search, Database, System, Errors) já vêm provisionados, sem setup
manual. No Linux (fora do Docker Desktop), o Prometheus só alcança a API no host graças ao
`extra_hosts` já configurado no `docker-compose.yml`.

## API

Todas as rotas abaixo são prefixadas com `/api/v1`.

| Rota | Descrição |
|------|-----------|
| `GET /search?q=&limit=&offset=&dataset=` | Busca full-text. `q` obrigatório (1-500 chars), `limit` 1-100 (padrão 20), `offset` ≥0, `dataset` filtra por UUID do dataset. |
| `GET /datasets` | Lista os datasets já indexados, mais recente primeiro. |
| `GET /health` | Status de Postgres e Redis. `200` se ambos ok, `503` se algum caiu. |

Exemplo:

```bash
curl "http://localhost:3000/api/v1/search?q=rondonia&limit=5"
```

## Testes

```bash
npm test                  # roda a suíte (sobe um Postgres efêmero via testcontainers)
npm test -- --coverage    # com relatório de cobertura
```

Testes de integração usam um container Postgres isolado por execução — não tocam no banco
de desenvolvimento. Redis, por enquanto, usa a instância real do `docker-compose` (precisa
estar rodando para os testes de `/health` passarem).

## Como contribuir

Este é um projeto solo de aprendizado, mas issues e PRs são bem-vindos:

1. Abra uma issue descrevendo o problema ou a proposta antes de codar algo grande
2. `npm run type-check && npm run lint && npm test` precisam passar antes de um PR
3. Commits seguem o padrão `ARARA-NNN: descrição curta`, referenciando a issue do roadmap

## Estrutura do repositório

```
src/
├── api/routes/          # rotas HTTP (search, datasets, health)
├── services/
│   └── ingester/         # ingestão de datasources externas (strategy pattern)
├── database/             # client Postgres, queries, migrations
├── cache/                # client Redis
├── observability/        # logger estruturado (Pino)
├── types/
├── app.ts                # monta o Fastify (testável, sem listen)
└── server.ts             # bootstrap do processo (listen + shutdown)
tests/
├── unit/
├── integration/
└── globalSetup.ts         # sobe o Postgres efêmero pros testes
migrations/                # arquivos .sql, aplicados em ordem (up/down)
docs/
├── ADRs/                  # decisões arquiteturais
├── runbooks/
└── design/                 # identidade visual (referência para UI futura)
```

## Roadmap

O desenvolvimento segue milestones M0–M5, cada um com um objetivo concreto (fundação,
crescimento, concorrência, observabilidade, testes, documentação). Decisões arquiteturais
de cada fase ficam registradas em `docs/ADRs`.
