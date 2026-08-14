import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStrategy } from '../../src/services/ingester/datasources/tseCandidatos.js';

const datasetId = '00000000-0000-0000-0000-000000000000';

const HEADER = [
  'SQ_CANDIDATO',
  'NM_URNA_CANDIDATO',
  'DS_CARGO',
  'SG_PARTIDO',
  'SG_UF',
  'NM_UE',
  'DS_SIT_TOT_TURNO',
  'DS_GENERO',
  'DS_COR_RACA',
  'DS_GRAU_INSTRUCAO',
  'ANO_ELEICAO',
].join(';');

function csvRow(values: Record<string, string>): string {
  return HEADER.split(';')
    .map((col) => `"${values[col] ?? '#NULO'}"`)
    .join(';');
}

function buildZip(filesToRows: Record<string, string[]>): Buffer {
  const zip = new AdmZip();
  for (const [fileName, rows] of Object.entries(filesToRows)) {
    const csv = [HEADER, ...rows].join('\r\n');
    zip.addFile(fileName, Buffer.from(csv, 'latin1'));
  }
  return zip.toBuffer();
}

function stubFetch(zipBuffer: Buffer | (() => Buffer | Promise<Buffer>)): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    const buf = typeof zipBuffer === 'function' ? await zipBuffer() : zipBuffer;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('tseCandidatos normalize', () => {
  const strategy = makeStrategy(datasetId);

  it('builds title/content/metadata from a full raw record', () => {
    const doc = strategy.normalize({
      SQ_CANDIDATO: '123456',
      NM_URNA_CANDIDATO: 'DANIEL',
      DS_CARGO: 'VEREADOR',
      SG_PARTIDO: 'PDT',
      SG_UF: 'RR',
      NM_UE: 'CARACARAÍ',
      DS_SIT_TOT_TURNO: 'NÃO ELEITO',
      DS_GENERO: 'MASCULINO',
      DS_COR_RACA: 'PARDA',
      DS_GRAU_INSTRUCAO: 'SUPERIOR COMPLETO',
      ANO_ELEICAO: '2024',
    });

    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.datasetId).toBe(datasetId);
    expect(result?.title).toBe('DANIEL - VEREADOR - PDT/RR');
    expect(result?.content).toContain('vereador');
    expect(result?.content).toContain('CARACARAÍ (RR)');
    expect(result?.content).toContain('não eleito');
    expect(result?.metadata).toEqual({
      candidatoId: '123456',
      cargo: 'VEREADOR',
      partido: 'PDT',
      uf: 'RR',
      municipio: 'CARACARAÍ',
      situacao: 'NÃO ELEITO',
      genero: 'MASCULINO',
      corRaca: 'PARDA',
      grauInstrucao: 'SUPERIOR COMPLETO',
      anoEleicao: '2024',
    });
    expect(result?.sourceUrl).toBeNull();
  });

  it('treats TSE null markers (#NULO, #NE) as absent', () => {
    const doc = strategy.normalize({
      SQ_CANDIDATO: '1',
      NM_URNA_CANDIDATO: 'FULANO',
      DS_CARGO: '#NULO',
      SG_PARTIDO: '#NE',
    });

    const result = Array.isArray(doc) ? doc[0] : doc;
    expect(result?.title).toBe('FULANO');
    expect(result?.content).toBe('FULANO');
    const metadata = result?.metadata as Record<string, unknown>;
    expect(metadata.cargo).toBeNull();
    expect(metadata.partido).toBeNull();
  });

  it('throws when SQ_CANDIDATO is missing', () => {
    expect(() => strategy.normalize({ NM_URNA_CANDIDATO: 'FULANO' })).toThrow();
  });

  it('throws when NM_URNA_CANDIDATO is missing or blank', () => {
    expect(() => strategy.normalize({ SQ_CANDIDATO: '1' })).toThrow();
    expect(() => strategy.normalize({ SQ_CANDIDATO: '1', NM_URNA_CANDIDATO: '#NULO' })).toThrow();
  });

  it('exposes the expected datasource name', () => {
    expect(strategy.datasource).toBe('tse-candidatos-2024');
  });
});

describe('tseCandidatos fetch', () => {
  const strategy = makeStrategy(datasetId);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('extracts and parses rows from every per-UF CSV, skipping the consolidated BRASIL file', async () => {
    const zip = buildZip({
      'consulta_cand_2024_AC.csv': [csvRow({ SQ_CANDIDATO: '1', NM_URNA_CANDIDATO: 'A' })],
      'consulta_cand_2024_RR.csv': [csvRow({ SQ_CANDIDATO: '2', NM_URNA_CANDIDATO: 'B' })],
      'consulta_cand_2024_BRASIL.csv': [
        csvRow({ SQ_CANDIDATO: '1', NM_URNA_CANDIDATO: 'A' }),
        csvRow({ SQ_CANDIDATO: '2', NM_URNA_CANDIDATO: 'B' }),
      ],
      'leiame.pdf': [],
    });
    stubFetch(zip);

    const result = await strategy.fetch();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r['SQ_CANDIDATO'])).toEqual(['1', '2']);
  });

  it('decodes Latin-1 accented characters correctly', async () => {
    const zip = buildZip({
      'consulta_cand_2024_RR.csv': [csvRow({ SQ_CANDIDATO: '1', NM_URNA_CANDIDATO: 'JOÃO', NM_UE: 'CARACARAÍ' })],
    });
    stubFetch(zip);

    const [row] = await strategy.fetch();
    expect(row?.['NM_URNA_CANDIDATO']).toBe('JOÃO');
    expect(row?.['NM_UE']).toBe('CARACARAÍ');
  });

  it('retries the download and succeeds on a later attempt', async () => {
    vi.useFakeTimers();
    const zip = buildZip({ 'consulta_cand_2024_RR.csv': [csvRow({ SQ_CANDIDATO: '1', NM_URNA_CANDIDATO: 'A' })] });
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

  it('gives up after exhausting retries on a persistent failure', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new Error('down')));
    vi.stubGlobal('fetch', fetchMock);

    const promise = strategy.fetch();
    const assertion = expect(promise).rejects.toThrow('down');
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3); // MAX_ATTEMPTS
  });
});
