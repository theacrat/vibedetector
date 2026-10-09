CREATE TABLE providers (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  maker TEXT NOT NULL,
  status TEXT NOT NULL,
  statusLabel TEXT NOT NULL,
  logo TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  position INTEGER NOT NULL
);
INSERT INTO providers VALUES
('10000000-0000-4000-8000-000000000001','claude','Claude','Anthropic','https://status.claude.com','Official status','/logos/claude.svg',1,0),
('10000000-0000-4000-8000-000000000002','chatgpt','ChatGPT','OpenAI','https://status.openai.com','Official status','/logos/chatgpt.svg',1,1),
('10000000-0000-4000-8000-000000000003','gemini','Gemini','Google','https://aistudio.google.com/status','Official status','/logos/gemini.svg',1,2),
('10000000-0000-4000-8000-000000000004','copilot','Copilot','GitHub','https://www.githubstatus.com','Official status','/logos/copilot.svg',1,3),
('10000000-0000-4000-8000-000000000005','grok','Grok','xAI','https://status.x.ai','Official status','/logos/grok.svg',1,4),
('10000000-0000-4000-8000-000000000006','mistral','Mistral','Mistral AI','https://status.mistral.ai','Official status','/logos/mistral.svg',1,5),
('10000000-0000-4000-8000-000000000007','deepseek','DeepSeek','DeepSeek','https://status.deepseek.com','Official status','/logos/deepseek.svg',1,6),
('10000000-0000-4000-8000-000000000008','cursor','Cursor','Anysphere','https://status.cursor.com','Official status','https://www.cursor.com/favicon.ico',1,7),
('10000000-0000-4000-8000-000000000009','zai','Z.AI','Z.AI','https://z.ai','Z.AI website','/logos/zai.svg',1,8),
('10000000-0000-4000-8000-000000000010','kimi','Kimi','Moonshot AI','https://status.moonshot.cn','Official status','/logos/kimi.svg',1,9);
CREATE TABLE identity_mapping_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO identity_mapping_guard SELECT CASE WHEN
  EXISTS (SELECT 1 FROM models m LEFT JOIN providers p ON p.slug = m.provider WHERE p.id IS NULL)
  OR EXISTS (SELECT 1 FROM reports r LEFT JOIN providers p ON p.slug = r.provider WHERE p.id IS NULL)
  OR EXISTS (SELECT 1 FROM reports r LEFT JOIN models m ON m.provider = r.provider AND m.name = r.model WHERE r.model IS NOT NULL AND m.name IS NULL)
  THEN 0 ELSE 1 END;
DROP TABLE identity_mapping_guard;
CREATE TABLE models_identified (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  position INTEGER NOT NULL,
  UNIQUE (provider, name),
  UNIQUE (provider, id)
);
INSERT INTO models_identified
SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6))), p.id, m.name, m.active, m.position
FROM models m JOIN providers p ON p.slug = m.provider;
CREATE TABLE reports_identified (
  provider TEXT NOT NULL REFERENCES providers(id),
  identity_hash TEXT NOT NULL,
  window INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  category TEXT CHECK (category IN ('nerfed','slow','broken')),
  model TEXT,
  PRIMARY KEY (provider, identity_hash, window),
  FOREIGN KEY (provider, model) REFERENCES models_identified(provider, id)
) WITHOUT ROWID;
INSERT INTO reports_identified
SELECT p.id, r.identity_hash, r.window, r.created_at, r.category, m.id
FROM reports r JOIN providers p ON p.slug = r.provider
LEFT JOIN models_identified m ON m.provider = p.id AND m.name = r.model;
DROP TABLE reports;
DROP TABLE models;
ALTER TABLE models_identified RENAME TO models;
ALTER TABLE reports_identified RENAME TO reports;
CREATE INDEX reports_provider_time ON reports(provider, created_at);
CREATE INDEX reports_retention ON reports(created_at);
CREATE INDEX models_provider_position ON models(provider, position);
