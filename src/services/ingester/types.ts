import type { InsertDocumentInput } from '../../database/queries.js';

export interface RawData {
  [key: string]: unknown;
}

export interface IngestionStrategy {
  readonly datasource: string;
  fetch(): Promise<RawData[]>;
  normalize(data: RawData): InsertDocumentInput | InsertDocumentInput[];
}
