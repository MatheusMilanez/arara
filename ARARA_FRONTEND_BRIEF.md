# ARARA Frontend — Project Brief

## 1. Identidade do Projeto

**Nome:** ARARA Frontend (`arara-web`)

**Tipo:** Interface de busca (SSR)

**Categoria:** Frontend / Discovery UX

**Abordagem:** AI First (usando Claude Code), mesmos princípios do backend

**Relação com o backend:** Consome a API REST já existente (`ARARA_TECHNICAL_SPEC.md`,
seção 5) — não reimplementa busca, não acessa Postgres/Redis diretamente.

**Visão:** A porta de entrada visual do "Google dos dados públicos do Brasil" —
`ARARA_PROJECT_BRIEF.md` já listava "Interface Web" como Future Scope (M5+). Este
documento é o M5+ acontecendo.

---

## 2. O Problema

O backend do ARARA já resolve ingestão, normalização, indexação e busca — mas só é
acessível via `curl` ou Postman. Ninguém fora de quem já sabe o que é uma API REST
consegue usar o que foi construído nas Milestones 0-5.

**O gap não é técnico, é de acesso:** dado indexado que só um dev consegue consultar não
cumpre a visão do projeto ("Descubra o conhecimento brasileiro", como o mockup já batiza).
Precisa de uma interface tão simples quanto pesquisar no Google — busca central, resultado
imediato, sem manual de instruções.

---

## 3. A Solução

Um frontend Next.js que renderiza a busca e os resultados server-side (importa pra SEO —
ver `ARARA_FRONTEND_TECHNICAL_SPEC.md`, seção 1), consumindo a API REST do backend:

```
USUÁRIO
   ↓
ARARA FRONTEND (Next.js, SSR)
   ├── Home (busca central)
   ├── Página de resultados (/buscar?q=...)
   └── Client components (interações: salvar estado da UI, animações)
        ↓  fetch (server-side, em build/request time)
ARARA API (Fastify, já existe)
   ├── GET /api/v1/search
   ├── GET /api/v1/datasets
   └── GET /api/v1/health
        ↓
POSTGRES + REDIS (já existem, sem mudança)
```

O frontend não introduz nenhum banco, cache ou fonte de dados nova — é uma camada de
apresentação em cima do que a Milestone 0-4 já construiu.

---

## 4. Escopo

### IN SCOPE (v1 — mapeado no mockup)

- ✅ Home com busca central (logo, tagline, campo de busca, botões Pesquisar/Explorar)
- ✅ Página de resultados: lista de documentos, contagem total, tempo de resposta
- ✅ Badge de origem por resultado (`dataset` — hoje `ibge-municipios`,
  `inep-escolas-2025`, `tse-candidatos-2024`)
- ✅ Paginação (a API já suporta `limit`/`offset`)
- ✅ Estados de carregamento, vazio (sem resultados) e erro (API fora do ar)
- ✅ SSR na página de resultados — a URL `/buscar?q=termo` é uma página real,
  indexável, compartilhável (link direto pra uma busca funciona)
- ✅ Responsivo (mobile-first — a maioria do tráfego de busca no Brasil é mobile)

### OUT OF SCOPE (v1 — visível no mockup, mas não implementado ainda)

- ❌ **"ARARA AI" / síntese** — badge e botão ficam visíveis na UI, mas desabilitados,
  com indicação clara de "em desenvolvimento" (ex: tooltip, badge cinza). Não chama
  nenhum provedor de IA. Ver `ARARA_FRONTEND_TECHNICAL_SPEC.md` seção 4 pro porquê disso
  ser um projeto à parte, não um botão a mais.
- ❌ **Abas de tipo (Dados/Documentos/APIs/Organizações)** — o schema atual do backend
  não tem campo de categoria; fica só a aba "Todos" funcional. As outras abas ficam
  visíveis e desabilitadas (mesma lógica do item acima), não escondidas — o design já foi
  validado com você, esconder muda a percepção da ferramenta.
- ❌ **"Salvar" resultado** — exige conta de usuário, que não existe. Ícone visível,
  desabilitado.
- ❌ **Contadores "847 nós ativos" / "37K fontes" / "18.2M recursos"** — números reais
  vêm da API (`GET /api/v1/datasets`, contagem de documentos), não hardcoded do mockup.
  Hoje isso significa 3 fontes reais e ~650 mil documentos — bem menor que o mockup, e
  isso é intencional: número real, por menor que seja, é melhor que número de design.
- ❌ Autenticação / contas de usuário
- ❌ "Explorar" como uma experiência própria (o botão existe no mockup; v1 só leva pra
  busca vazia — navegação por categoria é escopo futuro)

### FUTURE SCOPE (v2+)

- 🔮 "ARARA AI" — síntese via LLM sobre os resultados (RAG)
- 🔮 Facetas reais por tipo de conteúdo (exige mudança de schema no backend)
- 🔮 Contas de usuário + "Salvar" persistente
- 🔮 Filtros avançados (por dataset, por período, por UF)
- 🔮 Página "Explorar" com navegação por categoria/dataset

---

## 5. Objetivos de Aprendizado

Continuação direta dos objetivos do backend (`ARARA_PROJECT_BRIEF.md` seção 5), agora do
lado do cliente:

1. **SSR vs CSR na prática** — quando cada renderização acontece, e por quê isso importa
   pra SEO de um produto de busca (não é teoria, é a razão da escolha do Next.js)
2. **Integração com API real** — tratar timeout, erro 500, resposta vazia — os mesmos
   cenários de falha que o `ARARA-401` (chaos testing) já provou que o backend expõe
3. **Performance percebida** — loading states, streaming, Core Web Vitals — "rápido"
   pra usuário não é o mesmo número que "p99 < 100ms" do backend (`ARARA-400`)
4. **Design system disciplinado** — token de cor/espaçamento/tipografia únicos, não
   valor mágico espalhado em cada componente
5. **Acessibilidade real** — um "Google dos dados públicos" que só funciona com mouse e
   visão perfeita não cumpre a visão do projeto

---

## 6. Princípios

Herdados do backend, sem alteração:

### 6.1 AI First (Não IA Replace)
IA ajuda na implementação, não na decisão. Você decide, eu executo. Cada decisão
importante → ADR (mesmo padrão, mesma pasta `docs/ADRs/`).

### 6.2 Evidence-Based Development
Não otimiza sem dado. Antes de adicionar uma facet/feature nova, confirma que a API
suporta — não constrói UI pra um endpoint que não existe.

### 6.3 Documentation as Code
Mesma disciplina: ADRs versionadas, decisões de design documentadas, não só código.

### 6.4 Real, não mockado
Cada tela em produção busca dado real da API. Números, contagens e resultados do mockup
foram referência visual, nunca a fonte de verdade.

---

## 7. Métricas de Sucesso

- [ ] Home e página de resultados funcionando contra a API real, com dado real
- [ ] SSR confirmado (não só "funciona", mas confirmado via `view-source:` ou
  Lighthouse que o HTML já vem com o resultado, sem depender de JS rodar primeiro)
- [ ] Responsivo confirmado em pelo menos 2 larguras de viewport (mobile + desktop)
- [ ] Estados de erro/vazio/carregando implementados e testados, não só o caminho feliz
- [ ] Pelo menos 1 ADR documentando a decisão de stack (este brief + spec técnica cobrem
  a base; o ADR formaliza como as decisões anteriores do backend)
- [ ] Deploy funcionando (Vercel é o caminho natural pra Next.js, mas fica em aberto —
  ver `ARARA_FRONTEND_TECHNICAL_SPEC.md`)

---

## 8. Estrutura de Ownership

Igual ao backend: você decide, eu implemento, reviso e explico o porquê de cada escolha
não-trivial antes de fazer. Cada milestone, validada e documentada.

---

## 9. Timeline (proposta)

Bem menor que os 12 semanas do backend — a superfície de um frontend de busca é menor que
um sistema de ingestão/concorrência/observabilidade inteiro:

| Fase | Milestone | Foco |
|---|---|---|
| 1 | FE-M0 | Setup Next.js, design tokens, integração com a API real |
| 2 | FE-M1 | Home + página de resultados funcionando, com os estados (loading/vazio/erro) |
| 3 | FE-M2 | Polish: responsivo, acessibilidade, performance (Core Web Vitals) |
| 4 | FE-M3 | Deploy + documentação (ADR de stack, runbook de deploy) |

Detalhado ticket por ticket em `ARARA_FRONTEND_ROADMAP.md`.

---

## 10. Stack (Decidido)

**Next.js 15 (App Router) + TypeScript + Tailwind CSS**, confirmado com você em
2026-08-19. Motivo, na íntegra, vai pro `ARARA_FRONTEND_TECHNICAL_SPEC.md` seção 1 — aqui
o resumo:

- SSR real importa pra um produto de busca que quer ser encontrável — um SPA puro deixaria
  as próprias páginas de resultado invisíveis pro Google, o que briga direto com a visão
  do projeto.
- TypeScript compartilhado com o backend (mesmo tipo `SearchResponseBody`, sem duplicar
  definição).
- React/Next.js é o framework com mais vaga no mercado brasileiro — mesmo critério do
  ADR-0001 na escolha do Node pro backend.

**Estrutura de repositório:** `frontend/` como pasta irmã de `src/` na raiz do
monorepo — não reestrutura o backend existente em `apps/api/`. Ver
`ARARA_FRONTEND_TECHNICAL_SPEC.md` seção 2 pro raciocínio completo.

---

## 11. Próximos Passos

1. Validar este brief com você ✓ (revisão pendente após este documento)
2. `ARARA_FRONTEND_TECHNICAL_SPEC.md` — estrutura de pastas, contrato com a API, padrões
   de código, CORS no backend (pré-requisito real, pequeno, ainda não existe)
3. `ARARA_FRONTEND_SKILL.md` — como eu devo me comportar construindo isso (mesmo padrão
   do `ARARA_SKILL.md`, adaptado pra frontend)
4. `ARARA_FRONTEND_ROADMAP.md` — milestones e issues executáveis, ticket por ticket
5. Começa o FE-M0

---

## 12. Contato / Dúvidas

Mesma regra do backend: decisão não-trivial, eu paro e explico antes de implementar.
Documento tudo em ADR quando a decisão for arquitetural.
