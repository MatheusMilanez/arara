# ADR-0004: Estratégia de Cache de Busca

## Status
ACCEPTED

## Context
Toda busca em `GET /api/v1/search` bate direto no índice `tsvector` do Postgres
(`ARARA-031`). Isso é rápido pro volume de dados que temos hoje, mas é trabalho repetido
sempre que a mesma combinação de `q`/`limit`/`offset`/`dataset` é buscada de novo — e
buscas repetidas são o caso comum, não a exceção, num serviço de busca público. A
Milestone 3 (`ARARA-300`) introduziu Redis como camada de cache pra evitar esse
retrabalho.

## Problem
Cachear busca tem duas armadilhas conhecidas, e o ticket original (`ARARA-300`) só
resolvia uma delas:

1. **Staleness sem controle** — se o cache só expira por TTL, um documento recém-ingerido
   pode ficar invisível na busca por até a duração do TTL inteiro.
2. **Colisão de chave** — o formato de chave do ticket original era
   `search:{q}:{limit}:{offset}`, sem `datasetId`. Uma busca filtrada por dataset e a
   mesma busca sem filtro colidiriam na mesma entrada de cache, e uma devolveria o
   resultado errado pra outra.

## Decision
Cache-aside implementado em `src/cache/searchCache.ts`, com quatro escolhas concretas:

1. **Cache na rota (`search.ts`), não em `searchDocuments()` (`queries.ts`)** —
   `queries.ts` continua sendo só acesso a banco; a decisão de cachear é da camada HTTP,
   não do módulo de dados.
2. **Chave inclui `datasetId`** — corrige a colisão descrita acima antes que ela
   acontecesse; `datasetId` ausente vira `_` na chave, não é omitido.
3. **TTL de 1h + invalidação por geração, não por `SCAN`+`DEL`** — cada chave carrega um
   número de geração (`search:v{N}:...`); toda ingestão chama `invalidateSearchCache()`,
   que só incrementa um contador (`INCR`, O(1)). Chaves da geração anterior nunca mais são
   lidas e expiram sozinhas pelo TTL — ninguém varre o Redis procurando o que apagar.
4. **Fallback silencioso pro Postgres em qualquer erro do Redis** — `getCachedSearch` e
   `setCachedSearch` capturam qualquer exceção (Redis fora do ar, timeout) e deixam a
   busca cair pro banco. Cache é uma otimização, nunca uma dependência dura da rota.

## Evidence
Testes reais, não estimativa:

- **Cache não serve dado desatualizado pra sempre, mas também não reflete escrita
  concorrente até ser invalidado** (`tests/integration/api.test.ts`, describe `cache
  (ARARA-300)`) — um documento inserido *depois* da primeira busca não aparece na segunda
  busca idêntica (veio do cache); depois de `invalidateSearchCache()`, a mesma busca já
  reflete o dado novo.
- **A colisão de chave por `datasetId` foi testada como regressão, não só como ideia**
  (`tests/unit/searchCache.test.ts`, `mesma busca com datasetId diferente não colide`) —
  duas buscas com o mesmo texto/limit/offset e `datasetId` diferente gravam e leem valores
  independentes.
- **O fallback funciona de verdade contra um Redis inalcançável**
  (`tests/unit/searchCache.test.ts`, describe `fallback quando o Redis está fora do ar`) —
  as três funções (`get`/`set`/`invalidate`) rodam contra um client apontado pra um
  endereço que não responde, e nenhuma lança exceção.
- **Cache hit é observável, não uma alegação** — `search_cache_hit_ratio` e
  `search_latency_ms{cache="hit"|"miss"}` (`ARARA-310`) estão expostos em `/metrics` e
  visíveis no dashboard Grafana "ARARA / Search" (`ARARA-320`); validamos manualmente que
  a query `histogram_quantile(0.95, sum(rate(search_latency_ms_bucket[5m])) by (le))`
  retorna número real (não `NaN`) contra tráfego de teste.

## O que NÃO temos evidência ainda
O ticket original (`ARARA-300`) descrevia o cenário como "buscas em datasets de 5M+ docs
levam 500ms+" e pedia hit ratio > 80% e latência 500ms → 20ms em cache hit. Nenhum dos
dois número foi medido de verdade:

- **Não existe dataset de 5M+ documentos neste projeto.** Os datasources reais ingeridos
  (INEP, TSE, IBGE) são ordens de grandeza menores. Os 500ms+ do problema original nunca
  aconteceram aqui — é a premissa do ticket, não uma medição nossa.
- **Não medimos hit ratio sob tráfego sustentado.** O único número observado veio de uma
  verificação manual pequena (poucas requisições) durante a validação do `ARARA-320` — não
  é evidência de hit ratio em produção, só prova que a métrica em si funciona.
- **Não medimos overhead de memória do Redis em escala.** `redis_memory_bytes` existe e
  funciona, mas só foi observado com o volume de teste, não com cardinalidade de chaves
  realista.

Preferimos declarar essas lacunas explicitamente a preencher o template com números que
não existem — mesma decisão tomada no ADR-0003.

## Trade-offs

| Aspecto | Ganho | Perda |
|---|---|---|
| Cache na rota, não em `queries.ts` | `queries.ts` continua um módulo previsível: só banco | Qualquer nova rota que precise de cache reimplementa a decisão de onde cachear — não fica automático por usar `searchDocuments()` |
| Invalidação por geração (`INCR`) em vez de `SCAN`+`DEL` | O(1), sem varrer o Redis, sem risco de bloquear o Redis num `KEYS`/`SCAN` grande | É uma invalidação *total*, não seletiva — uma ingestão em qualquer datasource descarta o cache de busca inteiro, mesmo buscas de datasets não afetados |
| Fallback silencioso pro Postgres | A rota de busca nunca cai por causa do Redis | Uma falha de Redis persistente não interrompe nada visivelmente — só fica mais lento e sem cache; sem olhar `/health` ou `search_cache_hit_ratio` no Grafana, passa despercebida |
| TTL de 1h | Cobre o caso comum (dado público, staleness de 1h é aceitável) sem precisar de invalidação seletiva por dataset | Se um dataset específico precisar de garantia mais forte que "1h ou até a próxima ingestão de qualquer fonte", o mecanismo atual não distingue |

## Consequences
1. Qualquer nova rota ou parâmetro de busca que mude o resultado (novos filtros, por
   exemplo) precisa entrar na chave do cache — a decisão do item 2 (incluir `datasetId`)
   não é um caso isolado, é o padrão a seguir: todo parâmetro que muda o resultado, muda a
   chave.
2. Todo ingester novo precisa continuar chamando `invalidateSearchCache()` ao terminar. Se
   um ingester for adicionado sem essa chamada, os dados dele aparecem "atrasados" em até
   1h nas buscas — sem erro, sem log, só cache desatualizado silenciosamente.
3. Falta o load test que provaria os números do ticket original (hit ratio > 80%, 500ms →
   20ms). Isso vira ação de acompanhamento quando o volume de dados justificar — não uma
   alegação desta ADR.
4. Se a invalidação total por geração se mostrar cara demais (datasets grandes descartando
   cache de datasets não relacionados com frequência), o próximo passo é invalidação por
   `datasetId` — uma geração por dataset em vez de uma geração global. Não implementado
   porque não há evidência ainda de que seja necessário.

## Related Issues
- `ARARA-300` (cache-aside implementado, incluindo a invalidação por geração)
- `ARARA-301` (invalidação de cache — resolvida dentro do escopo do `ARARA-300`, sem PR
  própria: não sobrou nada a fazer depois que a geração via `INCR` foi implementada)
- `ARARA-310` (métricas `search_cache_hit_ratio` e `search_latency_ms`)
- `ARARA-320` (dashboard Grafana "ARARA / Search", visualizando as métricas acima)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado se um load test real motivar invalidação seletiva por dataset em vez de
por geração global, ou se o TTL de 1h se mostrar inadequado pra algum dataset específico.

## References
- [Cache-Aside pattern (Microsoft Azure Architecture Center)](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [Redis — INCR](https://redis.io/docs/latest/commands/incr/)
- [Prometheus — Histograms and summaries](https://prometheus.io/docs/practices/histograms/)
