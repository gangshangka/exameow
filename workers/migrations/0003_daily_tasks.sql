CREATE TABLE IF NOT EXISTS daily_task_devices (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_task_assignments (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  external_id TEXT,
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  planned_minutes INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_task_assignments_device ON daily_task_assignments(token_hash, day);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_task_external ON daily_task_assignments(token_hash, external_id);
