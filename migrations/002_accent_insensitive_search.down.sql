CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE documents SET updated_at = updated_at;

DROP TEXT SEARCH CONFIGURATION IF EXISTS portuguese_unaccent;
DROP EXTENSION IF EXISTS unaccent;
