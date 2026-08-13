# ARARA

Indexação aberta e distribuída de dados, documentos e recursos públicos brasileiros.

## O que é

ARARA ingere dados de múltiplas fontes públicas (dados.gov.br, INEP, TSE, etc.), normaliza para um schema
consistente, indexa para busca full-text e expõe tudo via uma API REST simples.

Veja [ARARA_PROJECT_BRIEF.md](ARARA_PROJECT_BRIEF.md) para o problema e a motivação, e
[ARARA_TECHNICAL_SPEC.md](ARARA_TECHNICAL_SPEC.md) para a arquitetura e decisões técnicas.

## Stack

- Node.js 20+ / TypeScript
- Fastify (API)
- PostgreSQL 14 (dados + full-text search)
- Redis (cache, a partir do M3)
- Pino (logs estruturados) · Prometheus (métricas)
- Vitest + Supertest (testes)

## Setup local

Pré-requisitos: Node.js 20+, Docker.

```bash
npm install
docker-compose up -d
cp .env.example .env
npm run migrate:up
npm run dev
```

O servidor sobe em `http://localhost:3000`.

## Testes

```bash
npm test                  # roda a suíte
npm test -- --coverage    # com relatório de cobertura
```

## Estrutura do repositório

```
src/
├── api/routes/        # rotas HTTP (search, datasets, health)
├── services/
│   ├── ingester/       # ingestão de datasources externas
│   ├── normalizer.ts
│   ├── indexer.ts
│   └── search.ts
├── database/           # client Postgres, queries, migrations
├── cache/               # client Redis (M3+)
├── observability/       # logger, métricas
├── types/
└── app.ts               # entrypoint
tests/
├── unit/
├── integration/
└── e2e/
migrations/               # arquivos .sql, aplicados em ordem
docs/
├── ADRs/                 # decisões arquiteturais
├── runbooks/
└── design/                # identidade visual (referência para UI futura)
```

## Roadmap

O desenvolvimento segue milestones M0–M5, detalhados em [ARARA_ROADMAP.md](ARARA_ROADMAP.md).
