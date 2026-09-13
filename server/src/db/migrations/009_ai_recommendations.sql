-- LLM-generated personal recommendations (the AI coach), one row per person x
-- range. input_json is the exact compact snapshot sent to the model (audit +
-- regenerate-on-change); output_json is the validated payload. Additive only:
-- dropping the feature leaves an unused table, nothing else.
CREATE TABLE ai_recommendations (
  user_id      INTEGER NOT NULL REFERENCES users(id),
  range_key    TEXT    NOT NULL,             -- 'YYYY-MM-DD_YYYY-MM-DD'
  generated_at TEXT    NOT NULL,             -- ISO UTC
  model        TEXT    NOT NULL,             -- Foundry deployment name
  input_hash   TEXT    NOT NULL,             -- sha256 of the canonical input JSON
  input_json   TEXT    NOT NULL,
  output_json  TEXT    NOT NULL,
  usage_json   TEXT,                         -- token usage for cost tracking
  PRIMARY KEY (user_id, range_key)
);
CREATE INDEX ix_ai_recs_generated ON ai_recommendations(generated_at);
