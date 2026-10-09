CREATE TABLE reports_with_models (
  provider TEXT NOT NULL CHECK (provider IN ('claude','chatgpt','gemini','copilot','grok','mistral','deepseek','cursor','zai','kimi')),
  identity_hash TEXT NOT NULL,
  window INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  category TEXT CHECK (category IN ('nerfed','slow','broken')),
  model TEXT,
  PRIMARY KEY (provider, identity_hash, window)
) WITHOUT ROWID;
INSERT INTO reports_with_models (provider, identity_hash, window, created_at, category)
SELECT provider, identity_hash, window, created_at, category FROM reports;
DROP TABLE reports;
ALTER TABLE reports_with_models RENAME TO reports;
CREATE INDEX reports_provider_time ON reports(provider, created_at);
CREATE INDEX reports_retention ON reports(created_at);
