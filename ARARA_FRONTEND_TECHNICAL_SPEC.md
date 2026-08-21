# ARARA Frontend — Technical Spec

Complementa o `ARARA_FRONTEND_BRIEF.md`. Aqui vai o "como": contrato real com a API
(não o desejado — o que existe hoje, verificado contra o código), estrutura de pastas,
tokens de design, e as decisões técnicas que decorrem dos gaps encontrados ao levantar
o estado atual do backend.

---

## 1. Contrato com a API (real, verificado contra `src/api/routes/`)

Todas as rotas abaixo já existem e funcionam, prefixadas com `/api/v1` (`src/app.ts`).

### `GET /api/v1/search?q=&limit=&offset=&dataset=`

```ts
{
  ok: true,
  data: Array<{
    id: string;
    title: string | null;
    dataset: string;        // source do dataset, ex: "ibge-municipios"
    relevance: number;
    metadata: Record<string, unknown> | null;
    source_url: string | null;
  }>;
  total: number;
  limit: number;
  offset: number;
}
```

`q` obrigatório (1-500 chars), `limit` 1-100 (padrão 20), `offset` ≥0, `dataset` filtra por
UUID do dataset. Query inválida → `400` com `{ ok: false, error, details }` (`search.ts:18`).

### `GET /api/v1/datasets`

```ts
{
  ok: true,
  data: Array<{
    id: string;
    source: string;
    name: string;
    description: string | null;
    row_count: number | null;
    indexed_at: string | null;   // ISO, ou null se nunca indexado
    metadata: Record<string, unknown> | null;
  }>;
}
```

Usado pro contador real da Home (nº de fontes, nº de documentos — soma de `row_count`).
Não existe endpoint de contagem agregada pronta; o frontend soma `row_count` client-side
(ou server-side, no fetch da Home) até isso justificar um endpoint dedicado.

### `GET /api/v1/health`

```ts
{
  status: 'ok' | 'error';
  timestamp: string;
  services: {
    database: { status: 'ok' | 'error'; latency_ms: number };
    redis: { status: 'ok' | 'error'; latency_ms: number };
  };
}
```

`200` se os dois serviços ok, `503` se algum caiu — é o sinal pro estado "ARARA fora do
ar" da UI (ver seção 5).

### Gap real: nenhum tipo é exportado hoje

`search.ts` e `datasets.ts` devolvem objetos inline — não existe um `SearchResponseBody`
ou `DatasetsResponseBody` importável. O brief original assumia esse tipo compartilhado;
ele precisa ser criado antes do frontend importar qualquer coisa.

**Decisão:** criar `src/types/api.ts` no backend, exportando os três tipos acima, e anotar
o retorno de cada rota com eles (`Promise<SearchResponseBody>` etc.) — assim um drift entre
rota e tipo quebra o `tsc`, não só a documentação. O frontend importa via caminho relativo
(`../../src/types/api.js`), sem publicar pacote nem usar npm workspaces — ver seção 3.

---

## 2. Pré-requisitos reais no backend (bloqueiam o frontend, pequenos de resolver)

### 2.1 CORS — não existe hoje

Confirmado: `@fastify/cors` não está no `package.json`, nenhum registro em `src/app.ts`.
Sem isso, todo fetch client-side (rodando no navegador) pra API é bloqueado.

**Decisão:** adicionar `@fastify/cors`, registrar em `app.ts` com **allowlist explícita**
via env var (`FRONTEND_ORIGIN`), não `origin: true` (reflete qualquer origem) — a API não
tem autenticação hoje, então não há sessão/cookie em risco, mas allowlist explícita é o
hábito correto e custa a mesma linha de código. `.env.example` ganha:

```
FRONTEND_ORIGIN=http://localhost:3002
```

Isso é uma decisão de segurança pequena mas real — se não for óbvia na hora de implementar
(ex: precisar de múltiplas origens em produção), vira ADR-0006.

### 2.2 Colisão de porta

API já ocupa `:3000`. Grafana (`docker-compose.yml`) já ocupa `:3001` no host. Next.js por
padrão também sobe em `:3000`.

**Decisão:** frontend roda em `:3002` (`next dev -p 3002` no `package.json` do
`frontend/`). Documentado no README do frontend e no README raiz.

---

## 3. Estrutura de repositório

```
arara/
├── src/                    # backend, sem mudança estrutural
│   └── types/
│       └── api.ts          # NOVO — tipos de resposta compartilhados (seção 1)
├── frontend/                # NOVO — Next.js App Router, package.json próprio
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx         # Home
│   │   └── buscar/
│   │       └── page.tsx     # /buscar?q=... — SSR
│   ├── components/
│   ├── lib/
│   │   └── api.ts           # cliente fetch tipado (importa src/types/api.ts)
│   ├── public/
│   ├── next.config.ts         # inclui turbopack.root (lockfile próprio, não workspace)
│   ├── package.json          # próprio — não é npm workspace com a raiz
│   └── tsconfig.json
├── docker-compose.yml        # sem mudança — frontend não precisa de container próprio em dev
└── README.md
```

`frontend/` tem `package.json`/`node_modules` próprios. Não vira um monorepo com npm
workspaces — só o *tipo* é compartilhado (import relativo), não dependências de runtime.
Simplicidade > DRY aqui: um workspace formal adicionaria configuração (`package.json` raiz
com `workspaces`, scripts cruzados) sem resolver um problema que hoje não existe (as duas
apps não compartilham lógica de execução, só um contrato de dados).

---

## 4. Design tokens (Tailwind v4, CSS-first), direto de `docs/design/VISUAL_IDENTITY.md`

**Atualizado (ARARA-702):** `create-next-app@latest` instalou Next.js 16 e Tailwind v4 —
decisão registrada em ADR-0007 (a spec original previa Next 15; mantivemos a versão mais
recente por ser projeto novo, sem código legado a migrar). Tailwind v4 não usa
`tailwind.config.ts` pra tokens simples — a configuração é CSS-first, via `@theme` em
`app/globals.css`:

```css
/* app/globals.css */
:root {
  --color-arara-blue: #0b1f33;      /* cor principal — logo, nav, botões primários */
  --color-arara-yellow: #f5c518;    /* accent — nunca cor dominante de área grande */
  --color-arara-green: #1e8e5a;     /* status positivo, uso restrito */
  --color-arara-bg: #fafaf7;        /* fundo (off-white, não branco puro) */
  --color-arara-text: #111111;
  --color-arara-text-secondary: #6b7280;
  --color-arara-border: #e5e7eb;
}

@theme inline {
  --color-arara-blue: var(--color-arara-blue);
  /* ...demais tokens, mesmo padrão */
  --font-sans: var(--font-inter);
}
```

Isso gera as classes utilitárias automaticamente (`bg-arara-blue`, `text-arara-yellow`
etc.) — sem objeto `colors` em arquivo `.ts`. Content detection também é automática no v4
(sem array `content` pra manter atualizado).

Fonte: **Inter**, via `next/font/google` (self-hosted pelo Next, sem request externo em
runtime). Hierarquia de tamanho já definida no VISUAL_IDENTITY (seção 6) — logo 48-64px,
título principal 32-40px, texto 15-17px, metadados 12-14px.

Sem dark mode: o VISUAL_IDENTITY.md não prevê tema escuro (fundo off-white é a identidade,
não um "light mode" com alternativa) — o boilerplate padrão do Next (`prefers-color-scheme:
dark` trocando as cores) foi removido de propósito.

Regra de design do próprio documento (seção 18), vale citar porque é a régua de decisão
mais reutilizável do brief inteiro: **não adicionar interface só porque existe
funcionalidade** — todo componente novo passa pelas 6 perguntas de lá antes de existir.

---

## 5. Estratégia de dados: onde cada fetch acontece

O objetivo de SSR do brief (seção 3) só se cumpre se a maior parte dos dados vier do
servidor, não do navegador. Mapeado explicitamente:

| Tela/ação | Onde busca | Por quê |
|---|---|---|
| Home — contadores (`/datasets`) | Server Component | conta real na primeira pintura, sem CORS envolvido (server→server) |
| `/buscar?q=...` — resultados | Server Component | página real, indexável, sem spinner no primeiro load — o próprio objetivo de SSR do brief |
| Paginação (`?q=...&offset=20`) | `<Link>` do Next, nova navegação SSR | mantém tudo server-side, evita depender de CORS pra algo que não precisa ser client-side |
| Campo de busca (submit) | `<form action="/buscar">` (GET) | funciona sem JS — progressive enhancement, mesmo padrão de qualquer motor de busca clássico |
| Retry num estado de erro | Client Component, fetch real ao navegador | único caso que de fato depende do CORS configurado na seção 2.1 |

Consequência prática: a superfície que realmente depende de CORS é pequena (retry/estado
de erro), mas precisa existir corretamente mesmo assim — não é motivo pra pular a seção 2.1.

### Estados (contrato de erro/vazio, direto da API real)

| Situação | Sinal da API | Estado da UI |
|---|---|---|
| Query inválida | `400`, `{ok:false, error, details}` | "o que você quer buscar?" — não é erro de sistema |
| `total: 0` | `200`, `data: []` | vazio, distinto de erro — sugestão de reformular busca |
| Backend fora do ar / timeout | `503` de `/health`, ou fetch falha | "ARARA fora do ar" — o cenário que o chaos testing (`ARARA-401`) já provou que existe de verdade, não hipotético |

---

## 6. Padrões de código

Mesma disciplina do backend (`CLAUDE.md`, convenções já em uso em `src/`):

- TypeScript strict, sem `any` sem justificativa.
- Server Components por padrão; `'use client'` só no componente-folha que precisa de
  interatividade real (não na página inteira).
- Tailwind puro — sem CSS-in-JS, sem valor mágico de cor/espaçamento fora dos tokens da
  seção 4.
- Comentários só quando o *porquê* não é óbvio (mesma regra do `CLAUDE.md` da raiz) — não
  documentar o que o componente faz, o nome já diz.
- Commits e comentários novos em português, seguindo `CLAUDE.md`.

---

## 7. Testes

- **Vitest + Testing Library** — componentes isolados (estados de loading/vazio/erro,
  renderização de badge por dataset).
- **Pelo menos 1 teste que confirma SSR de verdade** — não basta "funciona no navegador
  com JS", precisa provar que o HTML já vem populado (ex: Playwright fazendo request sem
  JS, ou inspecionando o HTML bruto da resposta antes da hidratação). Essa é a métrica de
  sucesso mais fácil de fingir que passou sem realmente confirmar — por isso vira teste
  automatizado, não só checagem visual.
- Mock da API via fetch stub (mesmo espírito dos testes de ingester do backend) —
  não sobe o backend real pra testar o frontend isoladamente.

---

## 8. ADRs previstas

A numeração continua a sequência do backend (`docs/ADRs/ADR-0001` a `ADR-0005` já
existem):

- **ADR-0006** — CORS e contrato de API (allowlist de origem, tipos compartilhados)
- **ADR-0007** — Stack do frontend (Next.js/SSR/Tailwind), formalizando a decisão que o
  `ARARA_FRONTEND_BRIEF.md` seção 10 já tomou em 2026-08-19
- ADR de deploy (FE-M3), se a escolha de plataforma não for óbvia na prática

---

## 9. O que este documento não decide

Copy exata, microinterações, e qualquer desvio do `docs/design/VISUAL_IDENTITY.md` são
decisão de tela, não de arquitetura — ficam para cada ticket do `ARARA_FRONTEND_ROADMAP.md`,
não para este spec.
