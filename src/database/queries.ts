import { pool } from './client.js';
import type { Document } from '../types/document.js';

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

export interface SearchDocumentsResult {
  documents: Array<Document & { relevance: number }>;
  total: number;
}

export async function searchDocuments(
  query: string,
  options: SearchDocumentsOptions = {},
): Promise<SearchDocumentsResult> {
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  const searchParams: unknown[] = [query, limit, offset];
  const searchDatasetFilter = options.datasetId ? `AND dataset_id = $${searchParams.push(options.datasetId)}` : '';

  const searchResult = await pool.query<DocumentRow & { relevance: number }>(
    `SELECT *, ts_rank(search_vector, websearch_to_tsquery('portuguese', $1)) AS relevance
     FROM documents
     WHERE search_vector @@ websearch_to_tsquery('portuguese', $1) ${searchDatasetFilter}
     ORDER BY relevance DESC
     LIMIT $2 OFFSET $3`,
    searchParams,
  );

  const countParams: unknown[] = [query];
  const countDatasetFilter = options.datasetId ? `AND dataset_id = $${countParams.push(options.datasetId)}` : '';

  const countResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM documents
     WHERE search_vector @@ websearch_to_tsquery('portuguese', $1) ${countDatasetFilter}`,
    countParams,
  );

  return {
    documents: searchResult.rows.map((row) => ({ ...mapRow(row), relevance: row.relevance })),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}
