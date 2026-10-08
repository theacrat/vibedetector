CREATE TABLE reports (
  provider TEXT NOT NULL CHECK (provider IN ('claude','chatgpt','gemini','copilot','grok','mistral','deepseek','cursor')),
  identity_hash TEXT NOT NULL,
  window INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  category TEXT CHECK (category IN ('nerfed','slow','broken')),
  PRIMARY KEY (provider, identity_hash, window)
) WITHOUT ROWID;
CREATE INDEX reports_provider_time ON reports(provider, created_at);
CREATE INDEX reports_retention ON reports(created_at);
