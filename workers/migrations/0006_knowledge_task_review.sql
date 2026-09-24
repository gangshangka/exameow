CREATE TABLE IF NOT EXISTS knowledge_points (
  token_hash TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (token_hash, id)
);

CREATE TABLE IF NOT EXISTS daily_task_history (
  token_hash TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (token_hash, id)
);
CREATE INDEX IF NOT EXISTS idx_task_history_day ON daily_task_history(token_hash, day);

DROP INDEX IF EXISTS idx_daily_task_external;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_task_external_day ON daily_task_assignments(token_hash, external_id, day);
ALTER TABLE daily_task_assignments ADD COLUMN knowledge_point_id TEXT;
ALTER TABLE flashcards ADD COLUMN knowledge_point_id TEXT;
