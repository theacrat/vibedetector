CREATE TABLE model_metadata (
  provider TEXT NOT NULL REFERENCES providers(id),
  external_id TEXT NOT NULL,
  metadata_json TEXT,
  source_url TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0,
  discovered_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'unknown')),
  PRIMARY KEY (provider, external_id)
) WITHOUT ROWID;
CREATE TABLE openai_document_cache (
  source_url TEXT PRIMARY KEY NOT NULL,
  document_json TEXT,
  checked_at INTEGER NOT NULL DEFAULT 0,
  succeeded_at INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
