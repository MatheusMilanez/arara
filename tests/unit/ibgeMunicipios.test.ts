import { describe, expect, it } from 'vitest';
import { makeStrategy } from '../../src/services/ingester/datasources/ibgeMunicipios.js';

const datasetId = '00000000-0000-0000-0000-000000000000';

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
