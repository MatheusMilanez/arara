# ADR-0006: CORS e Contrato de API Compartilhado

## Status
ACCEPTED

## Context
O frontend (`ARARA_FRONTEND_BRIEF.md`) consome a API REST já existente
(`GET /api/v1/search`, `/datasets`, `/health`) a partir de uma origem diferente (Next.js
em `:3002` contra a API em `:3000`). Levantar esse plano expôs dois gaps reais no backend,
nenhum dos dois hipotético — confirmados lendo o código, não assumidos:

1. **CORS não existia.** Nenhum registro de `@fastify/cors` em `src/app.ts`. Qualquer
   fetch feito pelo navegador (não servidor-a-servidor) pra API seria bloqueado.
2. **Nenhum tipo de resposta era compartilhável.** `search.ts` tinha um tipo local não
   exportado; `datasets.ts` e `health.ts` devolviam objetos inline sem tipo nenhum. Um
   consumidor externo (o frontend) não tinha o que importar.

## Problem
Resolver isso de qualquer jeito rápido introduziria dois riscos conhecidos:

- CORS aberto demais (`origin: true`, refletindo qualquer origem) é hábito ruim mesmo sem
  autenticação hoje — se a API ganhar sessão/cookie no futuro, um CORS já configurado como
  wildcard vira retrabalho de segurança, não just-in-time.
- Tipo duplicado entre backend e frontend (cada lado com sua própria definição de
  `SearchResponseBody`) diverge silenciosamente — nada quebra quando um campo muda de nome,
  só o frontend passa a receber `undefined` sem aviso.

## Decision

1. **`@fastify/cors` com allowlist explícita via env (`FRONTEND_ORIGIN`), nunca
   `origin: true`.** Sem a env configurada, a lista de origens permitidas fica vazia — todo
   pedido cross-origin de navegador é bloqueado por padrão (falha fechada, não aberta).
2. **`src/types/api.ts` como fonte única do contrato.** `SearchResponseBody`,
   `DatasetsResponseBody`, `HealthResponseBody` extraídos pra lá; cada rota tem o retorno
   anotado com o tipo (`Promise<T>` na assinatura do handler), não só documentado em prosa.
   O frontend importa esse arquivo via caminho relativo — sem publicar pacote, sem
   duplicar a forma do objeto.

## Evidence
- `tests/integration/api.test.ts`, describe `CORS (ARARA-700)`: três cenários reais, não
  hipotéticos — sem `FRONTEND_ORIGIN` configurada nenhuma origem passa; com a env
  configurada, a origem da allowlist recebe `Access-Control-Allow-Origin` no header e uma
  origem fora da lista não recebe.
- `npm run type-check` depois da extração dos tipos: nenhum erro — confirma que a mudança
  foi refatoração pura, sem alterar o formato real de resposta de nenhuma rota.

## Trade-offs

| Aspecto | Ganho | Perda |
|---|---|---|
| Allowlist explícita (env) vs. `origin: true` | Sem origem configurada, nada cross-origin funciona — erro aparece cedo, não em produção | Uma origem nova (ex: ambiente de staging do frontend) exige atualizar a env, não é automático |
| Tipos extraídos pra `src/types/api.ts` vs. inline em cada rota | Frontend importa o contrato real; drift quebra o `tsc` | Mais um arquivo pra manter sincronizado se um campo novo for adicionado a uma resposta |
| Import relativo (sem workspace/pacote publicado) | Zero configuração de monorepo, zero custo de publicação | Só funciona porque `frontend/` vive dentro do mesmo repositório — não escalaria pra um repositório separado sem revisitar isso |

## Consequences
1. Toda rota nova precisa do tipo de resposta em `src/types/api.ts` antes de ser
   considerada "pronta pro frontend consumir" — não é opcional, é o padrão daqui em diante.
2. Ambiente de produção do frontend precisa de `FRONTEND_ORIGIN` configurada na API antes
   do deploy (`ARARA-730`), ou toda chamada client-side falha silenciosamente por CORS.
3. Se o frontend algum dia sair do monorepo (repositório próprio), o import relativo do
   tipo deixa de funcionar — a decisão de import relativo é revisitada nesse momento, não
   antes.

## Related Issues
- `ARARA-700` (CORS)
- `ARARA-701` (tipos compartilhados)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado se o frontend sair do monorepo, ou se a API ganhar autenticação (a decisão
de CORS pode precisar de `credentials: true`, não coberto aqui porque não existe sessão
hoje).

## References
- [Fastify CORS plugin](https://github.com/fastify/fastify-cors)
- [MDN — CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)
