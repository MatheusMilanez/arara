-- Necessário pro upsert em lote (ARARA-210): sem uma chave natural por
-- documento, não tem o que colocar no ON CONFLICT.
ALTER TABLE documents ADD COLUMN external_id VARCHAR(255);
CREATE UNIQUE INDEX idx_documents_dataset_external_id ON documents (dataset_id, external_id);
