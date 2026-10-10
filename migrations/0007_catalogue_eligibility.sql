ALTER TABLE models ADD COLUMN first_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE models ADD COLUMN catalogue_metadata TEXT;
ALTER TABLE models ADD COLUMN filter_reason TEXT;
UPDATE models SET first_seen_at = unixepoch('subsec') * 1000;
