# ADR-0003: Estratégia de Concorrência na Ingestão Paralela

## Status
ACCEPTED

## Context
O ADR-0002 identificou que o throughput de insert (545–557 docs/s) era o teto real da
ingestão sequencial, e cotou a Opção D (paralelismo real entre lotes/datasources) — mas
adiou ela pro M2 de propósito: paralelismo sem proteção introduz race condition e
deadlock, e não fazia sentido implementar isso sem as salvaguardas certas. O M2
(`ARARA-200` a `ARARA-220`) construiu essas salvaguardas e entregou o paralelismo.

## Problem
Rodar os três datasources em paralelo (`ARARA-200`) significa múltiplas conexões
escrevendo no Postgres ao mesmo tempo. Sem cuidado, isso pode:

1. Deixar uma fonte que falha derrubar o processo inteiro, perdendo trabalho de fontes
   que já tinham terminado ou estavam no meio da ingestão.
2. Deadlockar, quando duas conexões travam as mesmas linhas em ordem diferente — isso não
   é hipotético: reproduzimos um deadlock real contra um Postgres real (`ARARA-210`).
3. Esgotar o pool de conexões sob picos de concorrência (3 ingestões + tráfego normal da
   API disputando o mesmo pool).

## Decision
Três mecanismos, cada um resolvendo um dos três riscos acima:

1. **Isolamento de falha via `Promise.allSettled`** (`runAll.ts`) — uma fonte falhando não
   derruba as outras; cada resultado (sucesso/falha) é reportado individualmente.
2. **Ordenar writes por chave antes do upsert** (`upsertDocuments`, `queries.ts`) — todo
   lote é ordenado por `(datasetId, externalId)` antes de virar um único
   `INSERT ... ON CONFLICT`, garantindo que chamadas concorrentes sempre pegam locks na
   mesma sequência. Isso elimina a possibilidade *estrutural* de ciclo de espera — não é
   uma redução de chance, é a remoção da pré-condição necessária pro deadlock existir.
3. **Pool de conexões dimensionado e observável** (`client.ts`) — `max: 20` cobre o pico
   de 3 ingestões em paralelo + tráfego normal da API; `min: 10` evita que o pool encolha
   de novo entre picos consecutivos; um monitor periódico loga o estado do pool e alerta
   quando ele está perto do limite.

## Evidence
Testes reais contra um Postgres real, não estimativa:

- **O deadlock é real, e o fix funciona** (`deadlock.test.ts`) — duas conexões travando as
  mesmas linhas em ordem trocada produzem `ERROR: deadlock detected` de verdade; as mesmas
  duas conexões, travando as mesmas linhas sempre na mesma ordem, não deadlockam — só
  esperam a vez.
- **O fix aguenta escala, não só o caso mínimo** (`raceConditions.test.ts`) — 100 chamadas
  concorrentes de `upsertDocuments()`, cada uma com um subconjunto aleatório embaralhado
  de 20 chaves compartilhadas (portanto ordens de lock quase sempre diferentes entre si):
  0 falhas, 0 deadlocks, estado final com exatamente as 20 linhas esperadas.
- **Leitura concorrente durante escrita não quebra nada** (`raceConditions.test.ts`) — 50
  buscas concorrentes disparadas durante a ingestão de 40 documentos: nenhuma busca falha
  (MVCC do Postgres garante isso), e o estado final é consistente.
- **O pool aguenta mais que seu próprio `max`** (`poolConcurrency.test.ts`) — 30 queries
  disparadas ao mesmo tempo contra um pool com `max: 20` resolvem todas; o excedente
  enfileira, não estoura.

## O que NÃO temos evidência ainda
O ticket original deste ADR (`ARARA-225`) pedia "stress test de 48 horas" e "3x de ganho
de performance medido". Nenhum dos dois foi feito:

- **Não medimos o tempo real de `npm run ingest:all` (paralelo) contra a soma sequencial**
  dos três ingesters. O ADR-0002 mediu o benchmark sequencial (545–557 docs/s); ninguém
  rodou o comparativo paralelo depois do `ARARA-200`. Fica como item em aberto — não como
  uma alegação de "3x mais rápido" sem número por trás.
- **Não rodamos stress test de longa duração.** Os testes de concorrência aqui provam
  ausência de deadlock em rajadas curtas e intensas (100 escritas de uma vez), não em uso
  contínuo por horas.

Preferimos declarar essas lacunas explicitamente a preencher o template com números que
não existem.

## Trade-offs

| Aspecto | Ganho | Perda |
|---|---|---|
| Ordenar por chave antes do upsert | Elimina deadlock estruturalmente | Custo de um sort por chamada — desprezível nos volumes testados (dezenas de linhas por lote) |
| `Promise.allSettled` em vez de `Promise.all` | Uma fonte falha sem afetar as outras | Quem chama precisa checar resultado por resultado, não só "deu certo ou não" |
| Pool com `min: 10` | Pool não encolhe de novo logo depois de um pico | `min` não abre conexão antecipada no boot — não acelera o primeiro pico depois do processo subir (comportamento real do `pg-pool`, não o que o nome sugere) |

## Consequences
1. Qualquer código novo que escreva em lote nesta tabela deve usar `upsertDocuments` (ou
   seguir o mesmo padrão de ordenação por chave) — não `insertDocument` num loop
   concorrente, ou reabre a janela de deadlock que este ADR fechou.
2. Falta medir o ganho real de throughput da ingestão paralela contra a baseline
   sequencial do ADR-0002. Isso vira uma ação de acompanhamento, não uma alegação desta
   ADR.
3. A ordenação por chave resolve deadlock entre chamadas de `upsertDocuments`; não cobre
   outra forma de escrita concorrente na mesma tabela que não passe por essa função (ex:
   um `UPDATE` direto fora dela). Se isso aparecer, precisa da mesma disciplina de
   ordenação.

## Related Issues
- `ARARA-121` / ADR-0002 (identificou o gargalo e adiou o paralelismo real pro M2)
- `ARARA-200` (ingestão paralela)
- `ARARA-210` (deadlock reproduzido e corrigido)
- `ARARA-211` (pool dimensionado e observável)
- `ARARA-220` (testes de concorrência em escala)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado se a ordenação por chave não for suficiente em volumes muito maiores que
os testados aqui, ou quando o benchmark real de throughput paralelo for medido.

## References
- [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [PostgreSQL — Deadlocks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-DEADLOCKS)
- [node-postgres — Pooling](https://node-postgres.com/apis/pool)
