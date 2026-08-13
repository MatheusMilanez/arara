# ARARA — Project Brief

## 1. Identidade do Projeto

**Nome:** ARARA

**Tipo:** Open Source Data Indexing Platform

**Categoria:** Data Infrastructure / Search / Discovery

**Abordagem:** AI First (usando Cursor + Claude Code)

**Objetivo Primário:** Brasil (dados públicos brasileiros)

**Visão Futura:** Plataforma de descoberta e indexação de dados públicos

---

## 2. O Problema

O Brasil possui enorme quantidade de dados públicos, documentos, datasets e APIs distribuídos entre:
- Portais governamentais (dados.gov.br)
- Instituições educacionais (INEP)
- Órgãos electorais (TSE)
- Registros de transparência
- Repositórios municipais

**O gap não é existência de dados. É:**
- Descobrir dados relevantes rapidamente
- Cruzar dados de múltiplas fontes
- Entender metadados inconsistentes
- Buscar com confiança

**Hoje:**
- Cada portal tem interface diferente
- Sem mecanismo centralizado de busca
- Formatos incompatíveis
- Difícil cruzar informações

---

## 3. A Solução

**ARARA** é um mecanismo de indexação que:

1. **Ingere** dados de múltiplas fontes públicas
2. **Normaliza** para um schema consistente
3. **Indexa** para busca rápida
4. **Expõe** via API simples

```
FONTES
(dados.gov.br, INEP, TSE, etc)
        ↓
   ARARA
   ├── Ingestor
   ├── Normalizer
   ├── Indexer
   └── Search API
        ↓
   USUÁRIOS
   (pesquisadores, devs, cidadãos)
```

---

## 4. Escopo

### IN SCOPE (M0-M4)

- ✅ Ingestão de 5+ datasources públicas
- ✅ Busca por texto, filtros, agregações
- ✅ API REST
- ✅ Full-text search
- ✅ Metadados estruturados
- ✅ Observabilidade (logs, métricas)
- ✅ Testes automatizados
- ✅ Deploy em Docker

### OUT OF SCOPE

- ❌ Descentralização P2P
- ❌ Blockchain
- ❌ Interface Web (por enquanto)
- ❌ Machine learning / AI modeling
- ❌ Replicação multi-região
- ❌ SLA de 99.99%

### FUTURE SCOPE (M5+)

- 🔮 Web UI
- 🔮 Embeddings + semantic search
- 🔮 RAG capabilities
- 🔮 Alertas de dados novos
- 🔮 Exportação em múltiplos formatos

---

## 5. Objetivos de Aprendizado

Este projeto existe para você dominar:

1. **Concorrência** — Múltiplas fontes de dados em paralelo
2. **Observabilidade** — Logs, métricas, traces
3. **Testing sob pressão** — Race conditions, deadlocks, load testing
4. **Decisão arquitetural** — Trade-offs documentados em ADRs
5. **Debugging distribuído** — Quando algo quebra, você consegue debugar
6. **Code that ages well** — Decisões documentadas ficam úteis

---

## 6. Princípios

### 6.1 AI First (Não IA Replace)

- IA ajuda na implementação, não na decisão
- Você decide, IA executa
- Cada decisão importante → ADR

### 6.2 Evidence-Based Development

- Não otimiza sem dado
- Benchmarking antes/depois
- Decisões baseadas em problema real, não imaginário

### 6.3 Documentation as Code

- ADRs são versionadas no Git
- Runbooks vivem no repo
- Logs contam histórias

### 6.4 Fail and Document

- Bug que você teve → Teste que previne
- Decisão errada → ADR que explica por que mudou
- Post-mortem quando quebra em produção

---

## 7. Métricas de Sucesso (ao final de 12 semanas)

- [ ] ~230 commits documentando evolução
- [ ] 10+ ADRs documentando cada decisão
- [ ] 80%+ test coverage com testes que importam
- [ ] Post-mortems de 3+ bugs que você teve
- [ ] Código que outra pessoa consegue clonar e rodar
- [ ] Performance baseline documentado
- [ ] Observabilidade funcionando (logs + métricas)

---

## 8. Estrutura de Ownership

**Você:** Engenheiro, tomador de decisão, debugger

**Claude Code:** Par que implementa, revisa, refatora

**Cada milestone:** Validada, documentada, com Definition of Done clara

---

## 9. Timeline

| Semana | Milestone | Foco |
|--------|-----------|------|
| 1-2 | M0 | Setup + primeiro ingester |
| 3-4 | M1 | Cresce e quebra (primeira dor) |
| 5-6 | M2 | Concorrência real (segunda dor) |
| 7-8 | M3 | Cache + observabilidade (terceira dor) |
| 9-10 | M4 | Testing sob pressão |
| 11-12 | M5 | Documentação + lições aprendidas |

---

## 10. Stack (Decidido)

Você vai usar **Node.js + TypeScript + Express** porque:
- Você já conhece
- Non-blocking IO é natural (goroutines em Go vs async/await aqui)
- Fácil de fazer request paralelas
- Comunidade grande em Brasil
- Empresas brasileiras contratam

**Stack completa:**
- **Runtime:** Node.js (v20+)
- **Language:** TypeScript
- **API Framework:** Express ou Fastify (Fastify é mais moderno)
- **Database:** PostgreSQL (com migrations)
- **Search:** Full-text search nativo em Postgres (luhn, tsvector)
- **Cache:** Redis (opcional em M3, mas planejado)
- **Observability:** Pino (logs) + Prometheus (métricas) + OpenTelemetry (traces)
- **Testing:** Vitest + Supertest (API testing)
- **CI/CD:** GitHub Actions
- **Container:** Docker + docker-compose

---

## 11. Próximos Passos

1. Validar stack com você ✓ (faremos)
2. Criar TECHNICAL SPECIFICATION ← você vai receber
3. Criar ARARA.skill.md ← a skill de desenvolvimento
4. Você entra no Cowork
5. Pede pro Claude Code: "Cria o boilerplate segundo essa spec"
6. Começa a trabalhar

---

## 12. Contato / Dúvidas

Perguntas enquanto desenvolvemos?
- Abra uma issue no repo
- Discuta com Claude Code antes de implementar
- Documente tudo em ADR

Vamos construir algo sério.

