DROP INDEX IF EXISTS idx_documents_dataset_external_id;
ALTER TABLE documents DROP COLUMN IF EXISTS external_id;
