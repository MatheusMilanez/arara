import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStrategy } from '../../src/services/ingester/datasources/camaraDeputados.js';

const datasetId = '00000000-0000-0000-0000-000000000000';

function jsonResponse(dados: unknown[], ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => ({ dados }) } as unknown as Response;
}

function stubFetch(impl: (url: string) => Promise<Response> | Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: string | URL | Request) => Promise.resolve(impl(String(input))));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function parseUrl(url: string): { tipo: string; inicio: string; fim: string; pagina: number } {
  return {
    tipo: url.match(/siglaTipo=([A-Z]+)/)?.[1] ?? '',
    inicio: url.match(/dataApresentacaoInicio=([\d-]+)/)?.[1] ?? '',
    fim: url.match(/dataApresentacaoFim=([\d-]+)/)?.[1] ?? '',
    pagina: Number(url.match(/pagina=(\d+)/)?.[1] ?? '1'),
  };
}

describe('camaraDeputados normalize', () => {
  const strategy = makeStrategy(datasetId);

  it('builds title/content/metadata/externalId from a full raw record', () => {
    const doc = strategy.normalize({
      id: 123456,
      siglaTipo: 'PL',
      numero: 42,
      ano: 2024,
      ementa: 'Dispõe sobre alguma coisa.',
      dataApresentacao: '2024-02-10',
    });

    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.datasetId).toBe(datasetId);
    expect(result?.externalId).toBe('123456');
    expect(result?.title).toBe('PL 42/2024');
    expect(result?.content).toBe('Dispõe sobre alguma coisa.');
    expect(result?.metadata).toEqual({ siglaTipo: 'PL', numero: 42, ano: 2024, dataApresentacao: '2024-02-10' });
    expect(result?.sourceUrl).toBe('https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=123456');
  });

  it('falls back to "Proposição {id}" when siglaTipo/numero/ano are missing', () => {
    const doc = strategy.normalize({ id: 999, ementa: 'Ementa qualquer' });
    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.title).toBe('Proposição 999');
    expect(result?.metadata).toEqual({ siglaTipo: null, numero: null, ano: null, dataApresentacao: null });
  });

  it('throws when id is missing', () => {
    expect(() => strategy.normalize({ ementa: 'X' })).toThrow();
  });

  it('throws when ementa is missing or empty', () => {
    expect(() => strategy.normalize({ id: 1 })).toThrow();
    expect(() => strategy.normalize({ id: 1, ementa: '' })).toThrow();
  });

  it('exposes the expected datasource name', () => {
    expect(strategy.datasource).toBe('camara-proposicoes');
  });
});

describe('camaraDeputados fetch', () => {
  const strategy = makeStrategy(datasetId);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('busca PL e PEC na(s) janela(s) trimestral(is) do ano corrente', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));

    const fetchMock = stubFetch((url) => {
      const { tipo, pagina } = parseUrl(url);
      return jsonResponse(pagina === 1 ? [{ id: tipo === 'PL' ? 1 : 2, ementa: 'Ementa' }] : []);
    });

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    // fim de fevereiro: só o 1º trimestre está aberto, 2 tipos => 2 janelas de busca
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => parseUrl(String(url)).tipo).sort()).toEqual(['PEC', 'PL']);
    expect(
      fetchMock.mock.calls.every(([url]) => {
        const { inicio, fim } = parseUrl(String(url));
        return inicio === '2024-01-01' && fim === '2024-02-15';
      }),
    ).toBe(true);
    expect(result).toHaveLength(2);
  });

  it('pagina até uma página vir com menos itens que o limite por página', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));

    const fetchMock = stubFetch((url) => {
      const { tipo, pagina } = parseUrl(url);
      if (tipo === 'PEC') return jsonResponse([]); // nada pra PEC nesta janela
      const items =
        pagina === 1
          ? Array.from({ length: 100 }, (_, i) => ({ id: i + 1, ementa: 'Ementa' }))
          : [{ id: 101, ementa: 'Ementa' }];
      return jsonResponse(items);
    });

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(3); // PL: página 1 + página 2, PEC: página 1
    expect(result).toHaveLength(101);
  });

  it('tenta de novo uma requisição que falha e mantém a janela quando uma tentativa seguinte funciona', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));

    let attempts = 0;
    const fetchMock = stubFetch((url) => {
      const { tipo } = parseUrl(url);
      if (tipo === 'PL') {
        attempts += 1;
        if (attempts < 2) return Promise.reject(new Error('network blip'));
      }
      return jsonResponse([{ id: 1, ementa: 'Ementa' }]);
    });

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(3); // PL (1 falha + 1 sucesso) + PEC (1 sucesso)
    expect(result).toHaveLength(2);
  });

  it('desiste de uma janela/tipo que esgota as tentativas e continua com o resto', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));

    const fetchMock = stubFetch((url) => {
      const { tipo } = parseUrl(url);
      if (tipo === 'PEC') return Promise.reject(new Error('down'));
      return jsonResponse([{ id: 1, ementa: 'Ementa' }]);
    });

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4); // PL (1 sucesso) + PEC (MAX_ATTEMPTS = 3, todas falham)
    expect(result).toHaveLength(1); // só o que veio do PL
  });
});
