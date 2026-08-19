# ADR-0001: Tech Stack Decision

## Status
ACCEPTED

## Context
ARARA precisa ingerir dados de fontes públicas brasileiras, normalizar para um schema
consistente, indexar para busca full-text e servir tudo via API REST. É um projeto solo,
com objetivo duplo: entregar algo funcional e, mais importante, forçar contato real com
problemas de sistemas em produção (concorrência, deadlocks, observabilidade) — não só
sintaxe de uma linguagem.

## Problem
Com qual stack construir isso, equilibrando produtividade (projeto solo, 12 semanas) e
aprendizado real de engenharia de sistemas?

## Options

### A) Python + Django + PostgreSQL
Pros: Django tem muita coisa pronta (admin, ORM, migrations), ecossistema maduro para dados.
Cons: Django é mais pesado que o necessário para uma API relativamente simples; async/await
em Django ainda é uma camada por cima de um framework historicamente síncrono.

### B) Go + Echo + PostgreSQL
Pros: Performance superior, goroutines tornam concorrência explícita e mais fácil de raciocinar
que callbacks/promises, binário único para deploy.
Cons: Curva de aprendizado da linguagem competiria com o aprendizado dos conceitos de sistemas
que são o objetivo real do projeto.

### C) Node.js + TypeScript + Fastify + PostgreSQL (escolhido)
Pros: TypeScript com strict mode dá segurança de tipos sem trocar de linguagem; async/await é
natural para um workload dominado por I/O (chamadas a APIs externas, queries); Fastify é rápido,
tem validação nativa e boa tipagem; comunidade forte no Brasil (relevante para o objetivo de
portfolio/contratação).
Cons: Sem concorrência real (single-threaded, event loop) — modelar paralelismo de verdade
exige atenção explícita (pool de conexões, `Promise.allSettled`, etc.) que uma linguagem com
threads nativas resolveria de forma diferente.

## Decision
Escolhido: Node.js + TypeScript + Fastify + PostgreSQL (C)

Razão:
- Já conheço JavaScript/TypeScript — o tempo do projeto vai para os conceitos de sistemas,
  não para aprender sintaxe nova
- O workload é dominado por I/O (ingestão de APIs externas, queries ao banco); async/await
  é o encaixe natural para isso
- Fastify é moderno, rápido, com validação (Zod) e tipagem integradas
- Comunidade Node forte no mercado brasileiro

## Trade-offs

| Aspecto | Ganho | Perda |
|---------|-------|-------|
| Produtividade | Já domino a linguagem, foco vai para os conceitos | Não aprendo uma linguagem nova como bônus |
| Concorrência | async/await simples para I/O-bound | Sem paralelismo real de CPU; single-threaded |
| Performance | Suficiente para o volume do projeto (milhares-milhões de docs) | Go seria objetivamente mais rápido em CPU-bound |
| Tipagem | TypeScript strict pega bugs em tempo de compilação | Configuração de tipos (`exactOptionalPropertyTypes` etc.) tem custo de fricção |

## Consequences

1. Precisaremos ser explícitos sobre concorrência onde a linguagem não ajuda de graça:
   pool de conexões com limite (`max: 20`), `Promise.allSettled` para isolar falhas entre
   datasources paralelos, ordenação de writes para evitar deadlock (M2 — `ARARA-210`).
   → Coberto no [ADR-0003](ADR-0003-concurrency.md), quando o M2 aconteceu de verdade.

2. Quando a carga de CPU (não I/O) virar o gargalo — por exemplo, processamento pesado de
   normalização de dados — Node vai precisar de workers (`worker_threads`) ou revisitar a
   decisão.

3. TypeScript em modo strict (`exactOptionalPropertyTypes: true`) já pagou dividendos reais
   nesta fase: pegou incompatibilidades de tipo entre o `pino` custom logger e o `FastifyBaseLogger`,
   e entre `REDIS_URL: string | undefined` e a API do client Redis — bugs que só apareceriam em
   runtime em uma stack mais frouxa.

## Evidência do M0

- O ingester do IBGE processou 5.571 registros a ~980–990 registros/segundo usando só
  `async/await` simples e um `pg.Pool` com `max: 20` — sem nenhuma primitiva de concorrência manual.
- Já batemos em um bug real de idempotência (rodar o ingester duas vezes duplicou todos os
  documentos) — não foi um problema de concorrência do Node, foi um gap de design no script.
  Vale registrar: nem todo bug de sistema é "culpa da stack".

## Related Issues
- `ARARA-001` (setup inicial)
- `ARARA-011` (pool de conexões)
- `ARARA-020` / `ARARA-021` (ingester + primeira ingestão real)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado se a decisão mudar.

## References
- [Fastify Documentation](https://fastify.dev)
- [Node.js Documentation](https://nodejs.org)
- [TypeScript Handbook — Strict Mode](https://www.typescriptlang.org/tsconfig#strict)
