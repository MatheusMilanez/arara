# ADR-0007: Stack do Frontend

## Status
ACCEPTED

## Context
O backend do ARARA (`ARARA_TECHNICAL_SPEC.md`, ADR-0001) resolve ingestão, normalização,
indexação e busca — mas só é acessível via `curl`/Postman. O `ARARA_FRONTEND_BRIEF.md`
propõe uma interface de busca real (SSR) consumindo a API REST existente, sem introduzir
banco, cache ou fonte de dado nova.

## Problem
Escolher stack de frontend para um produto de busca que precisa: SSR real (páginas de
resultado indexáveis pelo Google — a própria visão do projeto depende disso), TypeScript
compartilhado com o backend, e um framework com demanda real no mercado de trabalho
brasileiro (mesmo critério do ADR-0001 pro backend).

## Decision
**Next.js (App Router) + TypeScript + Tailwind CSS**, confirmado em 2026-08-19.

Duas decisões dentro dessa escolha precisaram ser revisitadas no `ARARA-702`, quando o
scaffold real (`create-next-app@latest`) rodou:

1. **Versão do Next: 16, não 15.** O brief original citava a 15 (mais recente na época). O
   scaffold instalou a 16 (lançada depois). Confirmado manter a mais recente — projeto
   novo, sem código legado pra migrar, sem motivo pra fixar numa versão que já não é a
   atual no primeiro commit.
2. **Tailwind v4, configuração CSS-first.** v4 não usa `tailwind.config.ts` com objeto
   `colors` (padrão v3) — os tokens de `docs/design/VISUAL_IDENTITY.md` viram variáveis CSS
   + `@theme inline` em `app/globals.css`. Sem arquivo de config JS pra tokens simples.
3. **Sem workspace/monorepo formal (`npm workspaces`).** `frontend/` tem `package.json` e
   `package-lock.json` próprios. Only o tipo de resposta da API é compartilhado (import
   relativo de `src/types/api.ts`, ver ADR-0006) — não há dependência de runtime cruzada
   que justifique workspace.

## Evidence
- `npm run build` (dentro de `frontend/`) compila com sucesso, `/` prerenderizada como
  conteúdo estático (`○ (Static)`).
- Tokens confirmados via inspeção real do DOM renderizado (não assumidos): `color:
  rgb(11, 31, 51)` (`#0B1F33`, `arara-blue`), `background-color: rgb(250, 250, 247)`
  (`#FAFAF7`, `arara-bg`), `font-family: Inter` — os três batendo exatamente com
  `docs/design/VISUAL_IDENTITY.md`.
- `tsc --noEmit` e `eslint` limpos no frontend recém-criado.
- Aviso do Turbopack sobre lockfile duplicado (detectou `package-lock.json` da raiz e do
  `frontend/`, dois workspaces aparentes) resolvido com `turbopack.root` explícito em
  `next.config.ts` — confirmado que o aviso desaparece depois do fix, não só assumido.

## Trade-offs

| Aspecto | Ganho | Perda |
|---|---|---|
| Next 16 em vez de fixar na 15 do brief original | Projeto novo começa sem dívida técnica de versão desde o primeiro commit | Breaking changes da 16 não estão no treinamento do modelo (o próprio `AGENTS.md` gerado avisa isso) — exige checar a doc real (`node_modules/next/dist/docs/`) em vez de assumir padrão conhecido |
| Tailwind v4 CSS-first | Menos arquivo de config, tokens vivem junto do CSS que já é editado pra estilo | Padrão diferente de tutoriais/exemplos Tailwind v3 (a maioria ainda documentada por aí) |
| Sem workspace formal | Zero configuração de monorepo | Import relativo do tipo compartilhado só funciona enquanto os dois projetos vivem no mesmo repositório (ver ADR-0006, consequência 3) |

## Consequences
1. Qualquer decisão futura que assuma comportamento do Next 15 (a maioria dos tutoriais e
   do conhecimento geral disponível) precisa ser validada contra a doc real da 16 antes de
   implementar — não confiar em padrão memorizado pra esse framework especificamente.
2. `turbopack.root` fica fixado em `next.config.ts` — se o repositório ganhar mais pastas
   com `package-lock.json` próprio no futuro, o aviso pode voltar e precisa do mesmo
   tratamento.
3. Tokens de cor só existem em `app/globals.css` — não há `tailwind.config.ts` pra
   verificar; o `ARARA_FRONTEND_SKILL.md` (checklist de design system) referencia esse
   arquivo, não um config `.ts`.

## Related Issues
- `ARARA-702` (scaffold do Next.js, tokens, porta 3002)
- `ARARA_FRONTEND_BRIEF.md` seção 10 (decisão original de stack, 2026-08-19)

## Supersedes
Nenhuma.

## Superseded by
Será atualizado se uma migração de major version do Next ou do Tailwind exigir mudança de
padrão (ex: volta de config CSS-first pra arquivo `.ts`, ou vice-versa).

## References
- [Next.js — App Router](https://nextjs.org/docs/app)
- [Next.js 16 — Route Props Helpers (`PageProps`/`LayoutProps`)](https://nextjs.org/docs/app/api-reference/file-conventions/page)
- [Tailwind CSS v4 — Theme variables](https://tailwindcss.com/docs/theme)
