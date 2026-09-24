CREATE TABLE IF NOT EXISTS attempt_records (
  token_hash TEXT NOT NULL,
  id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  PRIMARY KEY (token_hash, id)
);
CREATE INDEX IF NOT EXISTS idx_attempt_records_device_started ON attempt_records(token_hash, started_at DESC);
