// Tipos de resposta HTTP das rotas em src/api/routes/ — extraídos pra cá pra
// que o frontend (e qualquer outro consumidor) importe o contrato real em vez
// de reimplementar a mesma forma de objeto. Anotar o retorno de cada rota com
// esses tipos (em vez de só documentar em prosa) faz o tsc travar se rota e
// tipo divergirem.

export interface SearchResultItem {
  id: string;
  title: string | null;
  dataset: string;
  relevance: number;
  metadata: Record<string, unknown> | null;
  source_url: string | null;
}

export interface SearchResponseBody {
  ok: true;
  data: SearchResultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SearchErrorResponseBody {
  ok: false;
  error: string;
  details: Record<string, string[] | undefined>;
}

export interface DatasetResponseItem {
  id: string;
  source: string;
  name: string;
  description: string | null;
  row_count: number | null;
  indexed_at: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface DatasetsResponseBody {
  ok: true;
  data: DatasetResponseItem[];
}

export interface ServiceHealth {
  status: 'ok' | 'error';
  latency_ms: number;
}

export interface HealthResponseBody {
  status: 'ok' | 'error';
  timestamp: string;
  services: {
    database: ServiceHealth;
    redis: ServiceHealth;
  };
}
