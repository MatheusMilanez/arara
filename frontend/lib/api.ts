import type {
  DatasetsResponseBody,
  HealthResponseBody,
  SearchResponseBody,
} from "../../src/types/api";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 5_000;

// status ausente = falha de rede/timeout (nunca chegou a ter resposta);
// presente = a API respondeu, só que com um status de erro
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJson<T>(
  path: string,
  searchParams?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(path, API_URL);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    throw new ApiError(
      `Falha de rede ao chamar ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new ApiError(`${path} respondeu ${res.status}`, res.status);
  }

  return (await res.json()) as T;
}

export interface SearchParams {
  q: string;
  limit?: number;
  offset?: number;
  dataset?: string;
}

export function search(params: SearchParams): Promise<SearchResponseBody> {
  // SearchParams não tem index signature (é uma interface nomeada, não um
  // Record) — o cast é seguro porque todo campo dela já é string | number |
  // undefined, exatamente o que fetchJson espera
  return fetchJson<SearchResponseBody>(
    "/api/v1/search",
    params as unknown as Record<string, string | number | undefined>,
  );
}

export function listDatasets(): Promise<DatasetsResponseBody> {
  return fetchJson<DatasetsResponseBody>("/api/v1/datasets");
}

export function checkHealth(): Promise<HealthResponseBody> {
  return fetchJson<HealthResponseBody>("/api/v1/health");
}
