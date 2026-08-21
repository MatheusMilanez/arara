# ARARA Frontend

Interface de busca do ARARA (Next.js, App Router, SSR). Consome a API REST do backend
(`../src/`) — não acessa Postgres/Redis diretamente. Contexto completo em
[`../ARARA_FRONTEND_BRIEF.md`](../ARARA_FRONTEND_BRIEF.md) e
[`../ARARA_FRONTEND_TECHNICAL_SPEC.md`](../ARARA_FRONTEND_TECHNICAL_SPEC.md).

## Setup local

Pré-requisito: backend rodando (ver README da raiz) — o frontend não sobe nada sozinho,
só consome a API.

```bash
npm install
npm run dev
```

Sobe em **`http://localhost:3002`** (não a porta 3000 padrão do Next — a API do backend já
usa `:3000`, e o Grafana do `docker-compose` já usa `:3001`).

## Variáveis de ambiente

Neste projeto (`.env`, ver `.env.example`):

```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

E no `.env` da **raiz** — o CORS da API só libera o frontend se `FRONTEND_ORIGIN` estiver
configurada lá (ver `../.env.example`):

```
FRONTEND_ORIGIN=http://localhost:3002
```

## Stack

Next.js 16 (App Router) + TypeScript (strict) + Tailwind CSS v4. Decisão e trade-offs em
`docs/ADRs/ADR-0007-frontend-stack.md`.

## Design tokens

Cores e tipografia vêm de `docs/design/VISUAL_IDENTITY.md`, aplicadas via `@theme` em
`app/globals.css` (Tailwind v4 é CSS-first — não existe `tailwind.config.ts`).

## Testes

```bash
npm test
```

Vitest, com `fetch` mockado (mesmo padrão do backend) — não sobe o backend real pra testar
o cliente de API isoladamente (`lib/api.test.ts`).

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Dev server em `:3002` |
| `npm run build` | Build de produção |
| `npm start` | Serve o build em `:3002` |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
