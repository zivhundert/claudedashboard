-- Skill catalog: SKILL.md frontmatter scraped by pnpm skills:scan and pushed
-- to POST /api/skills/catalog.
--
-- Complements otel_skill_meta (008), which learns source/kind/plugin/marketplace
-- from skill_activated attributes automatically. Those are the authority for
-- where a skill came from; this table carries only what no event ever contains:
-- the description, version, allowed-tools and on-disk path from the frontmatter.
-- source/plugin_name are kept here as the scanner's own identity for a row
-- (they complete the unique key and build the plugin:skill name), not as a
-- second opinion on what telemetry already reports.
--
-- Range-independent: rows describe what a skill IS, never how often it ran.
CREATE TABLE skill_catalog (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,                   -- joins otel_skill_daily.skill_name
  source        TEXT NOT NULL CHECK (source IN ('personal','project','plugin','builtin')),
  plugin_name   TEXT NOT NULL DEFAULT '',        -- '' when absent (NULL breaks UNIQUE)
  description   TEXT NOT NULL DEFAULT '',
  version       TEXT,
  allowed_tools TEXT NOT NULL DEFAULT '[]',      -- JSON array of tool names
  model         TEXT,
  path          TEXT,                            -- home-relative SKILL.md dir
  reported_by   TEXT,                            -- scanning machine's label
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (name, source, plugin_name)
);
CREATE INDEX ix_skill_catalog_name ON skill_catalog(name);
