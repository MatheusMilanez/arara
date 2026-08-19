# ADR-0002: Gargalo de Performance na Ingestão

## Status
ACCEPTED

## Context
Com os três datasources do M1 rodando (IBGE, TSE, INEP), fizemos um benchmark real
(ARARA-120) rodando as três ingestões contra o banco de desenvolvimento, medindo cada
fase separadamente: fetch+normalize (via `Ingester.run()`, instrumentado com as métricas
do ARARA-110) e insert no Postgres (via `insertDocument()` em lotes de 50).

## Problem
A ingestão completa de um datasource grande (TSE, 463 mil registros) levou mais de 16
minutos. Antes de decidir se vale a pena otimizar — e o quê — precisávamos saber onde
esse tempo realmente vai: rede, parsing, ou banco.

## Evidência do Benchmark

| Datasource | Documentos | Fetch+parse | Insert | Total | Throughput insert |
|---|---:|---:|---:|---:|---:|
| IBGE | 5.571 | 6s | 10s | 16s | 557 docs/s |
| TSE | 463.833 | 135s | 833s (13m53s) | 968s (16m8s) | 557 docs/s |
| INEP | 180.540 | 96s* | 331s (5m31s) | 427s (7m7s) | 545 docs/s |

\* Fetch do INEP rodou a partir do zip já em disco (servidor de download do INEP bloqueia
o ambiente onde a ingestão foi executada), não é uma medição de rede real — não afeta a
conclusão sobre o insert, que é o foco desta ADR.

**O achado:** o throughput de insert é praticamente idêntico nos três datasources
(545–557 docs/segundo), independente do volume total ou do número de colunas por
documento. Isso não é coincidência — é o teto de uma estratégia de escrita, não uma
característica de nenhum datasource específico.

Para comparação: o fetch+parse do TSE processou 463 mil linhas a ~3.435 docs/segundo —
mais de 6× mais rápido que o insert conseguiu absorver. **O gargalo não é rede nem
parsing. É o Postgres, do jeito que escrevemos nele hoje.**

## Causa raiz
Cada datasource insere documentos em lotes de 50 (`BATCH_SIZE = 50`), mas dentro de cada
lote são 50 `INSERT INTO documents (...) VALUES (...) RETURNING *` **individuais**
(`Promise.allSettled` sobre 50 chamadas de `insertDocument()`), cada um pagando o
round-trip completo cliente↔Postgres. O próximo lote só começa depois que todo o lote
atual termina — não há sobreposição entre lotes.

## Options

### A) Aceitar por enquanto, documentar o limite
Pros: zero risco, zero trabalho agora.
Cons: qualquer datasource futuro maior que o TSE (500k+) vai demorar ainda mais; não
resolve, só adia.

### B) `INSERT` multi-row (um único statement por lote, não 50)
Pros: reduz 50 round-trips pra 1 por lote, sem mudar a forma de retorno (`RETURNING *`
funciona igual em multi-row insert); mudança pequena, isolada em `insertDocument`/nova
função de batch.
Cons: ainda é um lote de cada vez — não resolve se precisarmos de paralelismo entre lotes.

### C) `COPY FROM` (bulk load nativo do Postgres)
Pros: é literalmente o mecanismo mais rápido do Postgres pra carga em massa, ordens de
magnitude acima de INSERT.
Cons: não retorna as linhas inseridas (`RETURNING` não existe em `COPY`) — quebraria o
padrão atual onde `insertDocument` retorna o `Document` criado; exigiria repensar como os
scripts de ingestão sabem o que foi inserido. Mudança bem maior.

### D) Mais paralelismo entre lotes (múltiplos lotes concorrentes, respeitando o pool)
Pros: usa o pool de conexões (`max: 20`) de verdade — hoje ele está subutilizado, já que
um lote de 50 satura a fila da conexão e o próximo só começa depois.
Cons: é exatamente o tipo de mudança que introduz race conditions e deadlock — o M2
inteiro (`ARARA-200`/`ARARA-210`) existe pra tratar isso com cuidado. Fazer agora, sem essa
base, é arriscado.

## Decision
**B agora, D no M2.**

Trocar o insert de 50 chamadas individuais por lote para um único `INSERT` multi-row por
lote é uma mudança pequena, de baixo risco, que ataca a causa raiz medida (round-trips)
sem mexer em concorrência. C (`COPY`) fica descartado por enquanto — o ganho adicional não
compensa reformular o contrato de retorno de `insertDocument` nesta fase. D (paralelismo
real entre lotes) é natural pro M2, que já existe no roadmap especificamente pra
concorrência — não faz sentido antecipar isso sem as proteções (ordenação de writes,
testes de race condition) que o M2 vai construir.

## Trade-offs

| Aspecto | Ganho | Perda |
|---------|-------|-------|
| Insert multi-row (B) | Menos round-trips, mudança isolada e reversível | Não resolve o teto de paralelismo — ainda um lote por vez |
| Adiar paralelismo real pro M2 | Evita introduzir race condition sem as proteções certas | Ingestões grandes continuam lentas até o M2 acontecer |
| Não usar COPY agora | Mantém o contrato atual de `insertDocument` (retorna o Document) | Deixa na mesa o ganho de performance mais agressivo, caso precisemos dele antes do esperado |

## Consequences
1. `insertDocument` (ou uma nova função de batch) precisa aceitar múltiplos documentos e
   gerar um único `INSERT ... VALUES (...), (...), ...` — fica pra uma ticket própria, não
   implementado nesta ADR.
2. O benchmark do ARARA-120 vira a baseline: qualquer otimização futura (aqui ou no M2)
   deve ser comparada contra os 545–557 docs/s medidos hoje, não contra suposição.
3. Se um datasource futuro passar de alguns milhões de documentos, revisita-se C (`COPY`)
   — o ponto de virada é quando o ganho de multi-row insert (B) não for mais suficiente.

## Nota de finalização (revisão ARARA-500)
A decisão B (insert multi-row) **nunca foi aplicada nos três ingesters reais**. A função
que faz isso existe — `upsertDocuments()` em `src/database/queries.ts` — mas foi construída
depois, no M2, pro trabalho de correção de deadlock (`ARARA-210`), não como implementação
desta ADR. Os ingesters de IBGE, TSE e INEP continuam chamando `insertDocument()` num loop
de 50 chamadas individuais por lote (`Promise.allSettled`) — exatamente o padrão que esta
ADR identificou como o gargalo, não a solução.

Ou seja: a peça que resolveria isso já existe no código, só não está conectada. Os números
de throughput medidos aqui (545–557 docs/s) continuam sendo a realidade atual, não uma
baseline já superada. Fica como ação de acompanhamento explícita, não implementada por
decisão consciente ao revisar este ADR — trocar os ingesters pra `upsertDocuments()` é
mudança de produção real, com benchmark próprio pra confirmar o ganho, não algo pra fazer
de passagem numa revisão de documentação.

## Related Issues
- `ARARA-110` (métricas Prometheus, usadas pra medir isso)
- `ARARA-120` (benchmark que gerou a evidência desta ADR)
- `ARARA-121` (esta ADR)
- `ARARA-200`/`ARARA-210` (M2 — onde a Opção D será revisitada)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado se a decisão mudar (ex: se B não for suficiente e C precisar entrar antes
do previsto).

## References
- [PostgreSQL — INSERT](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL — COPY](https://www.postgresql.org/docs/current/sql-copy.html)
