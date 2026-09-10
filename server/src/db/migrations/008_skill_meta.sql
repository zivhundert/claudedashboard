-- What a skill IS, learned from skill_activated attributes: where it was
-- loaded from (builtin/bundled/plugin/user/project…), its definition kind,
-- and the plugin/marketplace it came with. One row per skill name; later
-- events only fill blanks and move last_seen_at forward.
CREATE TABLE otel_skill_meta (
  skill_name       TEXT PRIMARY KEY,
  source           TEXT,
  kind             TEXT,
  plugin_name      TEXT,
  marketplace_name TEXT,
  first_seen_at    TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL
);
