import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStrategy } from '../../src/services/ingester/datasources/inepEscolas.js';

const datasetId = '00000000-0000-0000-0000-000000000000';

const HEADER = [
  'CO_ENTIDADE',
  'NO_ENTIDADE',
  'NO_REGIAO',
  'SG_UF',
  'NO_UF',
  'NO_MUNICIPIO',
  'CO_MUNICIPIO',
  'TP_DEPENDENCIA',
  'TP_LOCALIZACAO',
  'TP_SITUACAO_FUNCIONAMENTO',
  'NU_ANO_CENSO',
].join(';');

function csvRow(values: Record<string, string>): string {
  return HEADER.split(';')
    .map((col) => values[col] ?? '')
    .join(';');
}

function buildZip(fileName: string, rows: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile(fileName, Buffer.from([HEADER, ...rows].join('\r\n'), 'latin1'));
  return zip.toBuffer();
}

function stubFetch(zipBuffer: Buffer): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(
    () =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength),
      }) as unknown as Promise<Response>,
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('inepEscolas normalize', () => {
  const strategy = makeStrategy(datasetId);

  it('builds title/content/metadata from a full raw record, translating coded fields', () => {
    const doc = strategy.normalize({
      CO_ENTIDADE: '11022558',
      NO_ENTIDADE: "EIEEF HAP BITT TUPARI",
      NO_REGIAO: 'Norte',
      SG_UF: 'RO',
      NO_UF: 'Rondônia',
      NO_MUNICIPIO: "Alta Floresta D'Oeste",
      CO_MUNICIPIO: '1100015',
      TP_DEPENDENCIA: '2',
      TP_LOCALIZACAO: '2',
      TP_SITUACAO_FUNCIONAMENTO: '1',
      NU_ANO_CENSO: '2025',
    });

    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.datasetId).toBe(datasetId);
    expect(result?.title).toBe("EIEEF HAP BITT TUPARI - RO");
    expect(result?.content).toContain("Alta Floresta D'Oeste (RO)");
    expect(result?.content).toContain('rede estadual');
    expect(result?.content).toContain('área rural');
    expect(result?.metadata).toEqual({
      entidadeId: '11022558',
      uf: 'RO',
      municipio: "Alta Floresta D'Oeste",
      regiao: 'Norte',
      dependencia: 'Estadual',
      localizacao: 'Rural',
      anoCenso: '2025',
    });
    expect(result?.sourceUrl).toBeNull();
  });

  it('falls back to the bare name when UF is missing', () => {
    const doc = strategy.normalize({ CO_ENTIDADE: '1', NO_ENTIDADE: 'Sem Estado' });
    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.title).toBe('Sem Estado');
  });

  it('leaves dependencia/localizacao null for unrecognized codes', () => {
    const doc = strategy.normalize({ CO_ENTIDADE: '1', NO_ENTIDADE: 'X', TP_DEPENDENCIA: '9', TP_LOCALIZACAO: '9' });
    const result = Array.isArray(doc) ? doc[0] : doc;
    const metadata = result?.metadata as Record<string, unknown>;
    expect(metadata.dependencia).toBeNull();
    expect(metadata.localizacao).toBeNull();
  });

  it('throws when CO_ENTIDADE is missing', () => {
    expect(() => strategy.normalize({ NO_ENTIDADE: 'X' })).toThrow();
  });

  it('throws when NO_ENTIDADE is missing or blank', () => {
    expect(() => strategy.normalize({ CO_ENTIDADE: '1' })).toThrow();
    expect(() => strategy.normalize({ CO_ENTIDADE: '1', NO_ENTIDADE: '' })).toThrow();
  });

  it('exposes the expected datasource name', () => {
    expect(strategy.datasource).toBe('inep-escolas-2025');
  });
});

describe('inepEscolas fetch', () => {
  const strategy = makeStrategy(datasetId);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('finds the school file by prefix regardless of the versioned folder/filename', async () => {
    const zip = buildZip(
      'microdados_censo_escolar_2025_v2/dados/Tabela_Escola_2025_V2.csv',
      [csvRow({ CO_ENTIDADE: '1', NO_ENTIDADE: 'Ativa', TP_SITUACAO_FUNCIONAMENTO: '1' })],
    );
    stubFetch(zip);

    const result = await strategy.fetch();
    expect(result).toHaveLength(1);
  });

  it('keeps only schools with TP_SITUACAO_FUNCIONAMENTO = 1 (Em Atividade)', async () => {
    const zip = buildZip('Tabela_Escola_2025_V2.csv', [
      csvRow({ CO_ENTIDADE: '1', NO_ENTIDADE: 'Ativa', TP_SITUACAO_FUNCIONAMENTO: '1' }),
      csvRow({ CO_ENTIDADE: '2', NO_ENTIDADE: 'Paralisada', TP_SITUACAO_FUNCIONAMENTO: '2' }),
      csvRow({ CO_ENTIDADE: '3', NO_ENTIDADE: 'Extinta', TP_SITUACAO_FUNCIONAMENTO: '3' }),
    ]);
    stubFetch(zip);

    const result = await strategy.fetch();
    expect(result).toHaveLength(1);
    expect(result[0]?.['NO_ENTIDADE']).toBe('Ativa');
  });

  it('drops columns outside the needed set', async () => {
    const zip = buildZip('Tabela_Escola_2025_V2.csv', [
      csvRow({ CO_ENTIDADE: '1', NO_ENTIDADE: 'Ativa', TP_SITUACAO_FUNCIONAMENTO: '1' }),
    ]);
    stubFetch(zip);

    const [row] = await strategy.fetch();
    expect(Object.keys(row ?? {}).sort()).toEqual(
      [
        'CO_ENTIDADE',
        'NO_ENTIDADE',
        'NO_REGIAO',
        'SG_UF',
        'NO_UF',
        'NO_MUNICIPIO',
        'CO_MUNICIPIO',
        'TP_DEPENDENCIA',
        'TP_LOCALIZACAO',
        'TP_SITUACAO_FUNCIONAMENTO',
        'NU_ANO_CENSO',
      ].sort(),
    );
  });

  it('throws a clear error when the school file is not found in the zip', async () => {
    const zip = buildZip('Tabela_Docente_2025_V2.csv', [csvRow({ CO_ENTIDADE: '1', NO_ENTIDADE: 'X' })]);
    stubFetch(zip);

    await expect(strategy.fetch()).rejects.toThrow(/não encontrado/);
  });

  it('retries the download and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    const zip = buildZip('Tabela_Escola_2025_V2.csv', [
      csvRow({ CO_ENTIDADE: '1', NO_ENTIDADE: 'A', TP_SITUACAO_FUNCIONAMENTO: '1' }),
    ]);
    let attempts = 0;
    const fetchMock = vi.fn(() => {
      attempts += 1;
      if (attempts < 2) {
        return Promise.reject(new Error('network blip'));
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = strategy.fetch();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(attempts).toBe(2);
    expect(result).toHaveLength(1);
  });
});
