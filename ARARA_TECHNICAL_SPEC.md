# ARARA — Technical Specification

## 1. Stack Overview

```
┌─────────────────────────────────────────────────────────┐
│                   ARARA Architecture                     │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Express/Fastify API Server (Node.js)     │   │
│  │              TypeScript + Fastify                │   │
│  └──────────────────────────────────────────────────┘   │
│                          ↓                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │         Service Layer (Business Logic)           │   │
│  │  - Ingester  - Normalizer  - Indexer  - Search  │   │
│  └──────────────────────────────────────────────────┘   │
│                          ↓                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │      Data Access Layer (Database + Cache)        │   │
│  │  - PostgreSQL (primary)  - Redis (cache, M3+)    │   │
│  └──────────────────────────────────────────────────┘   │
│                          ↓                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │           Observability Layer                     │   │
│  │  - Pino (logs) - Prometheus (metrics)            │   │
│  │  - OpenTelemetry (traces, M4+)                   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
│  External Dependencies:                                  │
│  - datasources (APIs públicas)                          │
│  - PostgreSQL 14+                                       │
│  - Redis 6+ (M3+)                                       │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Repository Structure

```
arara/
├── src/
│   ├── api/
│   │   └── routes/
│   │       ├── search.ts
│   │       ├── datasets.ts
│   │       └── health.ts
│   ├── services/
│   │   ├── ingester/
│   │   │   ├── index.ts
│   │   │   ├── strategy.ts
│   │   │   └── datasources/
│   │   │       ├── dadosGovBr.ts
│   │   │       ├── inep.ts
│   │   │       └── tse.ts
│   │   ├── normalizer.ts
│   │   ├── indexer.ts
│   │   └── search.ts
│   ├── database/
│   │   ├── client.ts
│   │   ├── migrations/
│   │   └── queries/
│   ├── cache/
│   │   └── redis.ts (M3+)
│   ├── observability/
│   │   ├── logger.ts
│   │   ├── metrics.ts
│   │   └── tracer.ts (M4+)
│   ├── types/
│   │   └── index.ts
│   └── app.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── migrations/
│   └── 001_initial_schema.sql
├── docs/
│   ├── ADRs/
│   ├── runbooks/
│   └── architecture/
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## 3. Key Technologies

### 3.1 Runtime & Framework

```
Node.js 20 LTS
├── Fastify (API framework)
├── TypeScript (type safety)
├── Zod (schema validation)
└── dotenv (env management)
```

**Why Fastify over Express:**
- Faster (benchmarks matter)
- Built-in validation
- Better async handling
- Modern TypeScript support

### 3.2 Database

```
PostgreSQL 14+
├── Full-text search (tsvector, tsquery)
├── JSONB for flexible metadata
├── Connection pooling (pg-boss or pg)
└── Migrations (node-pg-migrate or Typeorm)
```

**Schema (M0):**
```sql
CREATE TABLE datasets (
  id UUID PRIMARY KEY,
  source VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  description TEXT,
  schema JSONB,
  row_count BIGINT,
  indexed_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY,
  dataset_id UUID REFERENCES datasets(id),
  title VARCHAR(500),
  content TEXT,
  search_vector tsvector,
  metadata JSONB,
  source_url VARCHAR(1000),
  indexed_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_documents_search ON documents USING GIN(search_vector);
CREATE INDEX idx_documents_dataset ON documents(dataset_id);
```

### 3.3 Observability

**Logging:** Pino
```typescript
// Structured logging
logger.info({ 
  component: 'ingester',
  datasource: 'tse',
  operation: 'fetch',
  rows: 5000,
  duration_ms: 2500
}, 'Ingested dataset')
```

**Metrics:** Prometheus
```typescript
// Track what matters
- ingest_duration_seconds (histogram)
- search_latency_ms (histogram)
- cache_hit_ratio (gauge)
- database_connections (gauge)
- ingestion_errors_total (counter)
```

**Tracing:** OpenTelemetry (M4+)
- Trace cada request de ponta a ponta
- Correlate logs com traces

### 3.4 Testing

```
Vitest (unit tests, rápido)
├── Supertest (API testing)
├── pg (database testing)
└── testcontainers-node (PostgreSQL em Docker)
```

**Test Pyramid:**
- 60% Unit (services, normalizers)
- 30% Integration (API + database)
- 10% E2E (full flow)

### 3.5 CI/CD

```yaml
GitHub Actions:
├── Lint (eslint, prettier)
├── Type check (tsc)
├── Unit tests
├── Integration tests
├── Build Docker image
└── Push to registry
```

---

## 4. Datasources (Priority Order)

**M0-M1:** Start with 3

1. **dados.gov.br** (REST API)
   - ~5000 datasets
   - JSON responses
   - Rate-limited
   - Challenge: pagination, incomplete metadata

2. **TSE** (Transparency - electoral data)
   - Well-structured
   - CSV + JSON
   - Smaller volume
   - Challenge: large numbers, dates

3. **INEP** (Education ministry)
   - School data, test results
   - Multiple formats
   - Challenge: complex joins, aggregations

**M2-M3:** Add more
4. Portal da Transparência (government spending)
5. CNPJ registry

---

## 5. API Specification (M0)

### 5.1 Search Endpoint

```
GET /api/v1/search?q=&limit=20&offset=0

Query Parameters:
- q (string): Search query
- limit (number, default 20): Results per page
- offset (number, default 0): Pagination
- dataset (string, optional): Filter by dataset

Response:
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "title": "...",
      "dataset": "dados.gov.br",
      "relevance": 0.95,
      "metadata": {...},
      "source_url": "..."
    }
  ],
  "total": 1250,
  "limit": 20,
  "offset": 0
}
```

### 5.2 Datasets Endpoint

```
GET /api/v1/datasets

Response:
{
  "ok": true,
  "data": [
    {
      "id": "uuid",
      "source": "dados.gov.br",
      "name": "...",
      "row_count": 5000,
      "indexed_at": "2024-11-15T10:30:00Z",
      "metadata": {...}
    }
  ]
}
```

### 5.3 Health Endpoint

```
GET /api/v1/health

Response:
{
  "status": "ok",
  "timestamp": "2024-11-15T10:30:00Z",
  "services": {
    "database": { "status": "ok", "latency_ms": 2 },
    "cache": { "status": "ok", "latency_ms": 1 },
    "datasources": {
      "dados.gov.br": { "status": "ok", "last_check": "2024-11-15T10:25:00Z" }
    }
  }
}
```

---

## 6. Coding Standards

### 6.1 TypeScript Rules

```typescript
// ✅ GOOD: Explicit types, error handling, logging
async function ingestDataset(
  datasourceId: string,
  batchSize: number = 1000
): Promise<IngestResult> {
  try {
    logger.info({ datasourceId, batchSize }, 'Starting ingestion');
    
    const datasource = await getDatasource(datasourceId);
    if (!datasource) {
      throw new Error(`Datasource not found: ${datasourceId}`);
    }
    
    const result = await fetchAndIngest(datasource, batchSize);
    
    logger.info({ 
      datasourceId, 
      rows_ingested: result.count,
      duration_ms: result.duration 
    }, 'Ingestion completed');
    
    return result;
  } catch (error) {
    logger.error({ datasourceId, error: error.message }, 'Ingestion failed');
    throw error;
  }
}

// ❌ BAD: No types, no logging, unclear error handling
function ingest(id, size) {
  const data = fetchData(id, size);
  processData(data);
  return data.length;
}
```

### 6.2 Error Handling

```typescript
// Custom error types
class AraraError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AraraError';
  }
}

// Usage
try {
  // ...
} catch (error) {
  if (error instanceof AraraError) {
    res.status(error.statusCode).json({ 
      error: error.code, 
      message: error.message 
    });
  } else {
    logger.error({ error }, 'Unexpected error');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}
```

### 6.3 Concurrency

```typescript
// ✅ Use Promise.allSettled for robust parallel operations
const results = await Promise.allSettled(
  datasources.map(ds => ingestDatasource(ds))
);

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    logger.info({ datasource: datasources[index].id }, 'Success');
  } else {
    logger.error({ 
      datasource: datasources[index].id, 
      error: result.reason 
    }, 'Failed');
  }
});

// ❌ AVOID: Promise.all fails on first error
const results = await Promise.all(
  datasources.map(ds => ingestDatasource(ds))
);
```

### 6.4 Testing

```typescript
describe('Ingester', () => {
  it('should handle datasource API timeout gracefully', async () => {
    // Arrange
    const ingester = new Ingester();
    const timeoutMs = 5000;
    
    // Act
    const result = await ingester.ingest(
      mockDatasourceWithDelay(10000),
      { timeout: timeoutMs }
    );
    
    // Assert
    expect(result.status).toBe('timeout');
    expect(result.duration_ms).toBeGreaterThanOrEqual(timeoutMs);
  });
  
  it('should not deadlock on concurrent writes', async () => {
    // Specific to bug #42
    const tasks = Array(100)
      .fill(0)
      .map((_, i) => insertRecord({ id: i, data: 'test' }));
    
    const results = await Promise.allSettled(tasks);
    const failed = results.filter(r => r.status === 'rejected');
    
    expect(failed.length).toBe(0);
  });
});
```

---

## 7. ADR (Architecture Decision Record) Template

```markdown
# ADR-0001: Choose PostgreSQL for primary storage

## Status
ACCEPTED

## Context
We need to store indexed documents and metadata.
Requirements: ACID compliance, full-text search, schema flexibility.

## Problem
Choice between PostgreSQL, MongoDB, Elasticsearch:
- PostgreSQL: ACID, FTS, complex queries, vertical scaling limit
- MongoDB: Flexible schema, horizontal scaling, no ACID transactions
- Elasticsearch: FTS-first, great search, not designed for transactions

## Options

### A) PostgreSQL
Pros: ACID, native FTS, tsvector, JSONB for flexibility, most familiar
Cons: Vertical scaling limit (~1TB), requires careful indexing

### B) MongoDB
Pros: Flexible, horizontal scaling, document-native
Cons: No ACID transactions, FTS not as good, eventually consistent

### C) Elasticsearch + Postgres
Pros: Best of both worlds
Cons: Complexity, need to sync, cache invalidation (hard problem)

## Decision
Chosen: PostgreSQL (A)

Reason: 
- ACID gives us confidence in data integrity during concurrent ingests
- Native FTS (tsvector) is sufficient for M0-M3
- JSONB allows flexible metadata storage
- Everyone knows SQL
- If we hit vertical scaling limits, we revisit (ADR will reference this)

## Trade-offs

| Aspect | Gain | Loss |
|--------|------|------|
| Simplicity | Single storage system | No automatic horizontal scaling |
| Data integrity | ACID transactions | Must handle deadlocks |
| Flexibility | JSONB for metadata | Schema changes require migrations |

## Consequences

1. When we hit 100M+ documents, we may need to:
   - Partition data by time
   - Or add Elasticsearch as cache layer
   → Will be documented in future ADR

2. Concurrent ingests must be ordered to prevent deadlocks
   → Will be covered in testing strategy

3. Need expertise in Postgres optimization
   → Team grows to include DB specialist

## Related Issues
- #5 (Database selection)
- #21 (Concurrent writes deadlock)

## Supersedes
None

## Superseded by
Will update this as needed

## References
- PostgreSQL Documentation
- Full-text search: https://www.postgresql.org/docs/14/textsearch.html
```

---

## 8. Development Workflow

### 8.1 For Each Issue

```
Issue Created
    ↓
[YOU] Read issue + ask Claude Code: "What approach?"
    ↓
Claude Code proposes (A, B, C options)
    ↓
[YOU] Decide which option
    ↓
Claude Code: "Implement option B"
    ↓
Claude Code generates code
    ↓
[YOU] Review + run locally
    ↓
Claude Code: "Add tests for this"
    ↓
[YOU] Validate tests cover edge cases
    ↓
Git commit with issue reference
    ↓
If decision impacts architecture:
  [YOU] Write ADR
  ↓
  Claude Code reviews ADR for missing trade-offs
```

### 8.2 Rules for Claude Code

```
ALWAYS:
✅ Write TypeScript with explicit types
✅ Include structured logging
✅ Add tests (unit + integration)
✅ Handle errors explicitly
✅ Consider concurrency issues
✅ Update this spec if changing architecture
✅ Reference issue in commit message

NEVER:
❌ Use `any` type without explanation
❌ Add console.log (use logger)
❌ Ignore error cases
❌ Assume single-threaded execution
❌ Change database schema without migration
❌ Commit directly to main (always create branch)
```

---

## 9. Milestones Breakdown

### M0 (Weeks 1-2): Foundation
- [ ] Repository setup + CI
- [ ] First datasource ingester (dados.gov.br)
- [ ] Postgres schema + migrations
- [ ] Search endpoint (basic FTS)
- [ ] Datasets endpoint
- [ ] Structured logging
- [ ] Unit tests + integration tests
- [ ] ADR-0001 (database choice)
- [ ] Docker setup
- [ ] Health check

**Definition of Done:** 
- Someone can `git clone`, run `docker-compose up`, tests pass, API responds

### M1 (Weeks 3-4): Grows and Breaks
- [ ] Add 2 more datasources (INEP, TSE)
- [ ] Concurrency testing
- [ ] Performance metrics
- [ ] Prometheus metrics
- [ ] First bug: deadlock or OOM
- [ ] ADR-0002 (why it broke)

**Definition of Done:**
- 3 datasources indexed
- Performance baseline documented
- Post-mortem of first bug

### M2 (Weeks 5-6): Concurrency
- [ ] Worker pool for parallel ingestion
- [ ] Retry strategy + backoff
- [ ] Race condition tests (with `-race` flag)
- [ ] Connection pooling optimization
- [ ] ADR-0003 (concurrency strategy)

**Definition of Done:**
- Tests pass with `-race` flag
- No deadlocks under load

### M3 (Weeks 7-8): Observability
- [ ] Redis cache layer
- [ ] Cache invalidation strategy
- [ ] Full Prometheus metrics
- [ ] OpenTelemetry setup
- [ ] Grafana dashboard
- [ ] ADR-0004 (cache strategy)

**Definition of Done:**
- Metrics dashboard shows system behavior
- Traces connect logs to requests

### M4 (Weeks 9-10): Testing
- [ ] Load testing (k6)
- [ ] Chaos tests (datasource down)
- [ ] Contract tests
- [ ] Coverage > 80%
- [ ] ADR-0005 (testing strategy)

**Definition of Done:**
- Can confidently say "handles 1000 req/s" or "fails gracefully"

### M5 (Weeks 11-12): Documentation
- [ ] All ADRs reviewed
- [ ] Runbooks complete
- [ ] Post-mortems of 3 bugs
- [ ] Architecture diagrams
- [ ] Performance baselines
- [ ] "New contributor" guide

**Definition of Done:**
- Portfolio-ready project
- Someone else can understand decisions

---

## 10. Performance Targets

| Metric | M0 Target | M2 Target | M3 Target |
|--------|-----------|-----------|-----------|
| Search latency (p50) | <100ms | <50ms | <20ms |
| Search latency (p99) | <500ms | <200ms | <100ms |
| Throughput | 100 req/s | 500 req/s | 1000 req/s |
| Ingestion rate | 10k docs/s | 50k docs/s | 100k docs/s |
| Cache hit ratio | N/A | N/A | >80% |
| Error rate | <1% | <0.5% | <0.1% |

---

## 11. Security Considerations

### 11.1 Input Validation
```typescript
import { z } from 'zod';

const searchSchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0),
});

// Usage
const validated = searchSchema.parse(req.query);
```

### 11.2 Rate Limiting (M2+)
```typescript
// Prevent abuse
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100 // 100 requests per minute
}));
```

### 11.3 SQL Injection Prevention
- Use parameterized queries (pg library handles this)
- Never concatenate SQL strings
- Validate input schemas

### 11.4 Secrets Management
```typescript
// .env file (never commit)
DATABASE_URL=postgresql://user:pass@localhost:5432/arara
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
```

---

## 12. Dependency Management

**Core:**
```json
{
  "fastify": "^4.25.0",
  "pg": "^8.11.0",
  "redis": "^4.6.0",
  "pino": "^8.16.0",
  "pino-pretty": "^10.2.0",
  "zod": "^3.22.0"
}
```

**Observability:**
```json
{
  "@opentelemetry/api": "^1.7.0",
  "@opentelemetry/sdk-node": "^0.45.0",
  "prom-client": "^15.0.0"
}
```

**Testing:**
```json
{
  "vitest": "^0.34.0",
  "supertest": "^6.3.0",
  "testcontainers": "^9.1.0"
}
```

---

## 13. Deployment (M4+)

```dockerfile
# Production-grade Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY dist ./dist

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3000

CMD ["node", "dist/app.js"]
```

---

## 14. Conclusion

This specification is **living documentation**.

As you build and learn:
1. New decisions → Add ADRs
2. Architecture changes → Update this spec
3. Patterns emerge → Document in runbooks

This is not a prison. It's a guide that evolves.

Start with M0, build, learn, update.

