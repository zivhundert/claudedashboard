-- Append-only ledger of AI coach generations for cost tracking. The cache
-- table (ai_recommendations) is pruned after 30 days and overwritten on
-- regenerate, so it cannot answer "what has the coach cost so far". One row
-- per model call that produced a note; canned answers (no call) are not logged.
CREATE TABLE ai_generation_log (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id            INTEGER NOT NULL,
  generated_at       TEXT    NOT NULL,          -- ISO UTC
  model              TEXT    NOT NULL,          -- as echoed by the endpoint
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  structured         INTEGER NOT NULL DEFAULT 0, -- 1 = JSON-schema output was accepted
  attempts           INTEGER NOT NULL DEFAULT 1,
  duration_ms        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_ai_gen_log_at ON ai_generation_log(generated_at);
