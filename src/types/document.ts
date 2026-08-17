export interface Dataset {
  id: string;
  source: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown> | null;
  rowCount: number | null;
  indexedAt: Date | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Document {
  id: string;
  datasetId: string;
  externalId: string | null;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  sourceUrl: string | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
