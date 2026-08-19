# ARARA-401: Resultado do Chaos Testing

Os três cenários do ticket, e onde cada um está provado:

## 1. Pool de conexões do Postgres esgotado

**Teste:** [`tests/integration/poolConcurrency.test.ts`](../integration/poolConcurrency.test.ts),
describe `pool esgotado por tempo suficiente pra estourar o timeout (ARARA-401)`.

O teste anterior do M2 (`ARARA-211`) prova que uma *rajada* de 30 queries enfileira e
resolve — não prova o que acontece quando a fila em si não dá vazão a tempo. Este teste
novo segura as 20 conexões do pool com `pg_sleep(6)` de propósito, e dispara uma 21ª
query por cima.

**Resultado:** a 21ª query falha dentro do `connectionTimeoutMillis` configurado (5s), com
o erro padrão do `pg-pool` ("timeout exceeded when trying to connect") — não fica pendurada
esperando indefinidamente. Depois que as 20 seguradas liberam (6s), o pool volta ao estado
normal e novas queries funcionam sem qualquer intervenção. **Degrada graciosamente: falha
rápido e se recupera sozinho.**

**Gap conhecido, documentado e não corrigido nesta PR:** não existe `setErrorHandler`
customizado no Fastify (`src/app.ts`). Se esse timeout acontecer durante uma requisição
HTTP real (ex: `GET /api/v1/search` sob a carga do `ARARA-400`), o cliente recebe o 500
genérico do Fastify — `{"statusCode":500,"error":"Internal Server Error","message":"..."}`
— não o formato `{ok: false, ...}` usado no resto da API, e a mensagem crua do erro do
Postgres (não sensível, mas interna) vaza pro corpo da resposta. O processo não cai e o
pool se recupera — a falha é graciosa no nível do processo, só não é graciosa no nível do
contrato HTTP. Decisão consciente: registrar o gap, não corrigir agora — está fora do
escopo do que o ticket pede ("degrada graciosamente, não trava").

## 2. Redis fora do ar

**Teste:** [`tests/integration/api.test.ts`](../integration/api.test.ts), describe
`chaos: Redis fora do ar (ARARA-401)`.

O `ARARA-300` já tinha testes de fallback pro módulo de cache isolado
(`tests/unit/searchCache.test.ts`), provando que `getCachedSearch`/`setCachedSearch` não
lançam contra um Redis quebrado. O que faltava: provar isso na rota HTTP real, de ponta a
ponta, não só no módulo. Este teste simula o Redis indisponível (mock nos métodos `get`/
`set` do client real) e bate em `GET /api/v1/search` de verdade.

**Resultado:** `200`, resultado correto vindo do Postgres, log de warning registrando a
falha (`Falha ao ler cache de busca, seguindo direto pro banco`) — sem erro pro cliente.
Busca continua funcionando, só mais lenta (sem cache) — exatamente o que o ticket pede.

## 3. Timeout de API de datasource durante ingestão

**Teste:** [`tests/integration/runAllIngestion.test.ts`](../integration/runAllIngestion.test.ts),
`isola a falha de um datasource: os outros dois terminam normalmente` (já existia, do M2).

Não foi necessário escrever nada novo aqui. Um `fetch()` rejeitado (o teste existente
simula isso) é, do ponto de vista de quem chama, indistinguível de um timeout de rede real
— o `fetchWithRetry` de cada datasource já trata timeout como uma rejeição de `fetch()`
igual a qualquer outra falha de rede.

**Resultado (já provado antes deste ticket):** os outros dois datasources terminam
normalmente e inserem seus documentos; o datasource que falhou fica com `indexedAt: null`
e zero documentos — não há dado parcial/inconsistente. `ingest_errors_total` conta o
erro; `Promise.allSettled` em `runAll()` garante o isolamento.

## Resumo

| Cenário | Trabalho novo? | Resultado |
|---|---|---|
| Pool esgotado | Sim — teste novo | Falha rápido (5s), pool se recupera sozinho. Gap de contrato HTTP documentado, não corrigido |
| Redis fora do ar | Parcial — teste de rota, cache já tinha teste de módulo | Busca continua funcionando, mais lenta, sem erro pro cliente |
| Timeout de datasource | Não — já coberto pelo M2 | Isolamento de falha provado, sem dado parcial |
