# ADR-0005: Estratégia de Testes

## Status
ACCEPTED

## Context
A Milestone 4 (`ARARA-400` a `ARARA-410`) buscou confiança de que o sistema é confiável —
não só "os testes passam", mas "sabemos como ele se comporta sob carga e sob falha". Este
ADR consolida o que os quatro tickets da milestone realmente provaram, com os números
reais de cada um, não os números aspiracionais que o ticket original de cada um descrevia.

## Problem
"Confiança" não é um número único. Este ADR trata de três perguntas diferentes, cada uma
respondida por um tipo de teste diferente:

1. **O código está correto?** — testes unitários e de integração (`ARARA-410`).
2. **O sistema aguenta carga?** — load test (`ARARA-400`).
3. **O sistema degrada graciosamente sob falha, ou cai?** — chaos testing (`ARARA-401`).

## Decision

### Composição real da suíte
O ticket original (`ARARA-415`) pedia uma divisão 60% unit / 30% integration / 10% e2e.
A composição real é outra: **63 testes unitários, 42 de integração, 105 no total** — 60%
/ 40%, sem uma pasta `e2e/` separada em uso.

O diretório `tests/e2e/` existe e está **vazio** — um placeholder da estrutura inicial
(`ARARA-001`) que nunca foi preenchido. Isso não significa que não existe teste e2e: o
[`tests/integration/server.smoke.test.ts`](../../tests/integration/server.smoke.test.ts)
cumpre esse papel — sobe o processo real do servidor (`node --import tsx src/server.ts`),
bate nele por HTTP de verdade, e verifica o shutdown gracioso no `SIGTERM`. Ele só está
fisicamente na pasta errada. Decisão deste ADR: **documentar a realidade, não reorganizar
arquivos** — mover esse arquivo é reorganização de baixo risco, mas fora do escopo de "ter
uma estratégia de testes documentada".

### Meta de cobertura
`> 80%` foi atingido em três das quatro dimensões (`ARARA-410`): 91.53% statements, 92.19%
lines, 86.23% functions. **Branches ficou em 77.7%**, abaixo da meta — decisão consciente
de não perseguir os últimos pontos, documentada no próprio PR do `ARARA-410`: o que resta
são caminhos de retry/backoff dos três ingesters e o bloco `isMain` de `runAll.ts`
(mesma categoria de "bootstrap, verificado manualmente" que já exclui `server.ts` e
`migrations.ts` do relatório).

### Baseline de carga
O ticket original pedia "500 req/s sustentado, p99 < 100ms, erro < 1%". **Nenhuma das três
metas foi atingida** (`ARARA-400`, ver `tests/load/RESULTS.md`): 282 req/s reais, p99 de
5,69s, 8,88% de erro. Hipótese registrada (não confirmada experimentalmente): o pool de
conexões do Postgres (`max: 20`, dimensionado no `ADR-0003` pro cenário de ingestão
paralela, não pra esse volume de busca) é o teto real — o p95 observado (5,22s) fica bem
próximo do `connectionTimeoutMillis` (5s). O teste também rodou numa máquina de
desenvolvimento compartilhando recursos com toda a stack de observabilidade — não é medição
de capacidade de produção.

### Chaos testing
Os três cenários do ticket original (`ARARA-401`, ver `tests/chaos/RESULTS.md`):

| Cenário | Resultado |
|---|---|
| Pool de conexões esgotado | Falha rápido (dentro do `connectionTimeoutMillis`, 5s) em vez de travar; pool se recupera sozinho depois. Gap conhecido: sem `setErrorHandler` no Fastify, isso vira o 500 genérico do framework numa requisição HTTP real, não o formato `{ok: false, ...}` do resto da API |
| Redis fora do ar | Busca continua funcionando (200, dado do Postgres), só mais lenta, sem cache |
| Timeout de datasource na ingestão | Isolamento de falha provado desde o M2 — outros datasources terminam normalmente, sem dado parcial |

Nenhum dos três cenários derruba o processo. Os dois primeiros (pool, Redis) foram
verificados com teste automatizado nesta milestone; o terceiro já vinha coberto por
trabalho anterior.

## Evidence
Cada número acima veio de execução real, não estimativa:

- `npx vitest run --coverage` — 20 arquivos, 105 testes, números de cobertura reproduzidos
  em execução limpa (a suíte tem flakiness conhecida sob `--coverage` em máquina
  carregada — ver seção abaixo).
- `tests/load/search.js` rodado via `grafana/k6` contra a API real, com 649 mil documentos
  reais ingeridos (IBGE + INEP + TSE) — não um banco vazio.
- `tests/integration/poolConcurrency.test.ts` e `tests/integration/api.test.ts` — os dois
  testes novos do `ARARA-401` rodam contra Postgres e Redis reais (via `docker-compose`),
  não mocks de infraestrutura completa.

## O que NÃO temos evidência ainda
- **A causa raiz do gargalo de 500 req/s não foi confirmada experimentalmente.** A hipótese
  do pool de conexões é a mais provável, mas ninguém reexecutou o load test com
  `POOL_MAX` maior pra confirmar ou descartar.
- **Nenhum load test rodou em ambiente isolado.** Todos os números de capacidade vêm de uma
  máquina de desenvolvimento compartilhando recursos com Postgres, Redis, Prometheus,
  Grafana e o próprio container do k6.
- **A suíte de testes tem flakiness real sob `--coverage` em máquina carregada**, observada
  durante o `ARARA-410`: dois testes distintos (o de invalidação de cache e o smoke test do
  servidor) falharam esporadicamente em rodadas separadas da suíte completa, mas sempre
  passaram limpo quando executados isolados ou em subconjuntos menores — assinatura de
  contenção de recursos, não de bug determinístico no código. Não investigamos a fundo
  além de reproduzir o padrão; fica como item de acompanhamento se voltar a incomodar (por
  exemplo, numa pipeline de CI com menos recursos que esta máquina).

Preferimos declarar essas lacunas explicitamente a preencher o template com números que
não existem — mesma decisão dos ADR-0003 e ADR-0004.

## Trade-offs

| Aspecto | Ganho | Perda |
|---|---|---|
| Documentar a divisão real (60/40, sem pasta e2e separada) em vez de forçar a divisão do ticket | ADR reflete o sistema de verdade, não um template genérico | Quem ler o roadmap original sem este ADR pode achar que existe uma camada e2e dedicada que não existe |
| Aceitar branches em 77.7% em vez de perseguir 80%+ | Esforço investido onde o retorno é real (gaps genuínos: rota raiz, filtro de dataset, timer do pool) em vez de inflar número | Alguns caminhos de retry/backoff dos ingesters seguem sem teste direto |
| Publicar o resultado do load test mesmo sem bater a meta | Baseline real de capacidade, documentado, com hipótese de causa | Não existe hoje um número de "quantos req/s a API realmente aguenta" — só sabemos que não é 500 nesta configuração |

## Consequences
1. Se a rota de busca precisar sustentar tráfego na ordem de centenas de req/s de verdade,
   o próximo passo é confirmar a hipótese do pool (reexecutar o load test com `POOL_MAX`
   maior, em ambiente isolado) antes de qualquer mudança de configuração em produção —
   ação de acompanhamento do `ARARA-400`, não deste ADR.
2. Adicionar `setErrorHandler` no Fastify pra fechar o gap de contrato HTTP do cenário de
   pool esgotado (`ARARA-401`) é uma melhoria conhecida, não implementada — decisão
   consciente de escopo, documentada, não esquecimento.
3. Qualquer novo teste que precise rodar em CI com menos recursos que esta máquina de
   desenvolvimento deve levar em conta a flakiness observada sob `--coverage` — pode exigir
   retry automático no pipeline, não necessariamente uma correção no código de teste.
4. O diretório `tests/e2e/` vazio pode ser removido ou preenchido no futuro; não é uma
   pendência urgente, já que `server.smoke.test.ts` cumpre esse papel na prática.

## Related Issues
- `ARARA-400` (load test, meta não atingida, hipótese registrada)
- `ARARA-401` (chaos testing, três cenários, um gap de contrato HTTP documentado)
- `ARARA-410` (cobertura, 3 de 4 métricas acima de 80%)
- `ADR-0003` (pool de conexões `max: 20`, dimensionado pra outro cenário — hipótese central
  do `ARARA-400`)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado quando a hipótese do pool for confirmada ou descartada com um load test
isolado, ou se a flakiness da suíte sob `--coverage` for investigada a fundo.

## References
- [k6 — Test types](https://grafana.com/docs/k6/latest/testing-guides/test-types/)
- [Martin Fowler — Test Pyramid](https://martinfowler.com/bliki/TestPyramid.html)
- [Istanbul — Branch coverage](https://istanbul.js.org/docs/advanced/alternative-reporters/)
