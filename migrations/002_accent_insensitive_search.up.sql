CREATE EXTENSION IF NOT EXISTS unaccent;

-- Custom config so full-text search ignores accents (users type "municipio",
-- content has "município") while still keeping Portuguese stemming.
CREATE TEXT SEARCH CONFIGURATION portuguese_unaccent (COPY = portuguese);

ALTER TEXT SEARCH CONFIGURATION portuguese_unaccent
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, portuguese_stem;

CREATE OR REPLACE FUNCTION documents_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('portuguese_unaccent', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('portuguese_unaccent', coalesce(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE UPDATE fires on every targeted row regardless of whether the value
-- actually changes, so this re-derives search_vector for existing rows
-- under the new accent-insensitive config without duplicating the SQL above.
UPDATE documents SET updated_at = updated_at;
