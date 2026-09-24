CREATE TABLE IF NOT EXISTS flashcards (
  id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  source_text TEXT,
  source_question_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (token_hash, id)
);
CREATE INDEX IF NOT EXISTS idx_flashcards_device_updated ON flashcards(token_hash, updated_at);
