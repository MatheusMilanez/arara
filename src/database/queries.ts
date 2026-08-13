import { pool } from './client.js';
import type { Dataset, Document } from '../types/document.js';

interface DatasetRow {
  id: string;
  source: string;
  name: string;
  description: string | null;
  schema: Record<string, unknown> | null;
  row_count: string | null;
  indexed_at: Date | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

function mapDatasetRow(row: DatasetRow): Dataset {
  return {
    id: row.id,
    source: row.source,
    name: row.name,
    description: row.description,
    schema: row.schema,
    rowCount: row.row_count === null ? null : Number(row.row_count),
    indexedAt: row.indexed_at,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getDatasetBySource(source: string): Promise<Dataset | null> {
  const result = await pool.query<DatasetRow>(
    'SELECT * FROM datasets WHERE source = $1 ORDER BY created_at DESC LIMIT 1',
    [source],
  );
  const row = result.rows[0];
  return row ? mapDatasetRow(row) : null;
}

export interface InsertDatasetInput {
  source: string;
  name: string;
  description?: string | null;
  schema?: Record<string, unknown> | null;
  rowCount?: number | null;
  indexedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export async function insertDataset(input: InsertDatasetInput): Promise<Dataset> {
  const result = await pool.query<DatasetRow>(
    `INSERT INTO datasets (source, name, description, schema, row_count, indexed_at, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.source,
      input.name,
      input.description ?? null,
      input.schema ?? null,
      input.rowCount ?? null,
      input.indexedAt ?? null,
      input.metadata ?? null,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('insertDataset: insert returned no row');
  }
  return mapDatasetRow(row);
}

export async function markDatasetIndexed(id: string, rowCount: number): Promise<void> {
  await pool.query('UPDATE datasets SET row_count = $2, indexed_at = NOW(), updated_at = NOW() WHERE id = $1', [
    id,
    rowCount,
  ]);
}

export async function listDatasets(): Promise<Dataset[]> {
  const result = await pool.query<DatasetRow>(
    'SELECT * FROM datasets ORDER BY indexed_at DESC NULLS LAST, created_at DESC',
  );
  return result.rows.map(mapDatasetRow);
}

interface DocumentRow {
  id: string;
  dataset_id: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown> | null;
  source_url: string | null;
  indexed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: DocumentRow): Document {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    title: row.title,
    content: row.content,
    metadata: row.metadata,
    sourceUrl: row.source_url,
    indexedAt: row.indexed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface InsertDocumentInput {
  datasetId: string;
  title?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
  sourceUrl?: string | null;
  indexedAt?: Date | null;
}

export async function insertDocument(input: InsertDocumentInput): Promise<Document> {
  const result = await pool.query<DocumentRow>(
    `INSERT INTO documents (dataset_id, title, content, metadata, source_url, indexed_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.datasetId,
      input.title ?? null,
      input.content ?? null,
      input.metadata ?? null,
      input.sourceUrl ?? null,
      input.indexedAt ?? null,
    ],
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('insertDocument: insert returned no row');
  }

  return mapRow(row);
}

export async function getDocument(id: string): Promise<Document | null> {
  const result = await pool.query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id]);
  const row = result.rows[0];
  return row ? mapRow(row) : null;
}

export interface SearchDocumentsOptions {
  limit?: number;
  offset?: number;
  datasetId?: string;
}

export interface SearchResultDocument extends Document {
  relevance: number;
  dataset: string;
}

export interface SearchDocumentsResult {
  documents: SearchResultDocument[];
  total: number;
}

export async function searchDocuments(
  query: string,
  options: SearchDocumentsOptions = {},
): Promise<SearchDocumentsResult> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const searchParams: unknown[] = [query, limit, offset];
  const searchDatasetFilter = options.datasetId ? `AND d.dataset_id = $${searchParams.push(options.datasetId)}` : '';

  const searchResult = await pool.query<DocumentRow & { relevance: number; dataset_source: string }>(
    `SELECT d.*, ds.source AS dataset_source,
            ts_rank(d.search_vector, websearch_to_tsquery('portuguese_unaccent', $1)) AS relevance
     FROM documents d
     JOIN datasets ds ON ds.id = d.dataset_id
     WHERE d.search_vector @@ websearch_to_tsquery('portuguese_unaccent', $1) ${searchDatasetFilter}
     ORDER BY relevance DESC
     LIMIT $2 OFFSET $3`,
    searchParams,
  );

  const countParams: unknown[] = [query];
  const countDatasetFilter = options.datasetId ? `AND dataset_id = $${countParams.push(options.datasetId)}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM documents
     WHERE search_vector @@ websearch_to_tsquery('portuguese_unaccent', $1) ${countDatasetFilter}`,
    countParams,
  );

  return {
    documents: searchResult.rows.map((row) => ({ ...mapRow(row), relevance: row.relevance, dataset: row.dataset_source })),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}
