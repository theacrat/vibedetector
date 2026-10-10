CREATE TABLE synced_models (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  position INTEGER NOT NULL,
  external_id TEXT,
  UNIQUE (provider, id),
  UNIQUE (provider, external_id)
);
INSERT INTO synced_models (id, provider, name, active, position) SELECT id, provider, name, active, position FROM models;
CREATE TABLE synced_reports (
  provider TEXT NOT NULL REFERENCES providers(id),
  identity_hash TEXT NOT NULL,
  window INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  category TEXT CHECK (category IN ('nerfed','slow','broken')),
  model TEXT,
  PRIMARY KEY (provider, identity_hash, window),
  FOREIGN KEY (provider, model) REFERENCES synced_models(provider, id)
) WITHOUT ROWID;
INSERT INTO synced_reports SELECT * FROM reports;
DROP TABLE reports;
DROP TABLE models;
ALTER TABLE synced_models RENAME TO models;
ALTER TABLE synced_reports RENAME TO reports;
CREATE INDEX reports_provider_time ON reports(provider, created_at);
CREATE INDEX reports_retention ON reports(created_at);
CREATE INDEX models_provider_position ON models(provider, position);
CREATE TABLE catalogue_sync (
  provider TEXT PRIMARY KEY NOT NULL REFERENCES providers(id),
  attempted_at INTEGER NOT NULL DEFAULT 0,
  succeeded_at INTEGER NOT NULL DEFAULT 0,
  model_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Never synced',
  lease TEXT NOT NULL DEFAULT '',
  lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE catalogue_sync_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO catalogue_sync (provider) SELECT id FROM providers;
UPDATE providers SET active = 0 WHERE slug = 'copilot';
UPDATE models SET active = 0 WHERE provider IN (SELECT id FROM providers WHERE slug IN ('copilot', 'cursor', 'zai'));
