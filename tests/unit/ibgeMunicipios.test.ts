import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStrategy } from '../../src/services/ingester/datasources/ibgeMunicipios.js';

const datasetId = '00000000-0000-0000-0000-000000000000';
const TOTAL_UFS = 27;

function ufFromUrl(url: string): string {
  return url.match(/estados\/([A-Z]{2})\/municipios/)?.[1] ?? 'XX';
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

function stubFetch(impl: (url: string) => Promise<Response> | Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string | URL | Request) => Promise.resolve(impl(String(input))));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ibgeMunicipios normalize', () => {
  const strategy = makeStrategy(datasetId);

  it('builds title/content/metadata from a full raw record', () => {
    const doc = strategy.normalize({
      id: 1100015,
      nome: "Alta Floresta D'Oeste",
      microrregiao: {
        mesorregiao: {
          UF: { sigla: 'RO', nome: 'Rondônia', regiao: { nome: 'Norte' } },
        },
      },
    });

    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.datasetId).toBe(datasetId);
    expect(result?.title).toBe("Alta Floresta D'Oeste - RO");
    expect(result?.content).toContain('Rondônia');
    expect(result?.metadata).toEqual({ ibgeId: 1100015, uf: 'RO', regiao: 'Norte' });
    expect(result?.sourceUrl).toBe('https://servicodados.ibge.gov.br/api/v1/localidades/municipios/1100015');
  });

  it('falls back to the bare name when UF data is missing', () => {
    const doc = strategy.normalize({ id: 42, nome: 'Sem Estado' });
    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.title).toBe('Sem Estado');
    expect(result?.content).toBe('Sem Estado');
    expect(result?.metadata).toEqual({ ibgeId: 42, uf: null, regiao: null });
  });

  it('throws when id is missing', () => {
    expect(() => strategy.normalize({ nome: 'No Id' })).toThrow();
  });

  it('throws when nome is missing or empty', () => {
    expect(() => strategy.normalize({ id: 1 })).toThrow();
    expect(() => strategy.normalize({ id: 1, nome: '' })).toThrow();
  });

  it('exposes the expected datasource name', () => {
    expect(strategy.datasource).toBe('ibge-municipios');
  });
});

describe('ibgeMunicipios fetch', () => {
  const strategy = makeStrategy(datasetId);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fetches and aggregates municipios across every state', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch((url) => jsonResponse([{ id: 1, nome: `Cidade ${ufFromUrl(url)}` }]));

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toHaveLength(TOTAL_UFS);
    expect(fetchMock).toHaveBeenCalledTimes(TOTAL_UFS);
  });

  it('retries a failed request and keeps the state once a later attempt succeeds', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const fetchMock = stubFetch((url) => {
      if (ufFromUrl(url) === 'AC') {
        attempts += 1;
        if (attempts < 2) {
          return Promise.reject(new Error('network blip'));
        }
      }
      return jsonResponse([{ id: 1, nome: 'X' }]);
    });

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(TOTAL_UFS + 1); // one extra call for AC's retry
    expect(result).toHaveLength(TOTAL_UFS);
  });

  it('skips a state that keeps returning a non-2xx status and continues with the rest', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch((url) => jsonResponse([{ id: 1, nome: 'X' }], ufFromUrl(url) !== 'AC'));

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(TOTAL_UFS + 2); // AC retried MAX_ATTEMPTS (3) times total
    expect(result).toHaveLength(TOTAL_UFS - 1);
  });
});
