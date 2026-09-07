CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS series_tags (
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (series_id, tag_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS series_tags_tag_idx ON series_tags(tag_id, series_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS preview_fixture_runs (
  id TEXT PRIMARY KEY NOT NULL,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
