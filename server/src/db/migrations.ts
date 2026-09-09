/**
 * TS mirror of server/src/db/migrations/*.sql so the migration runner works
 * both under tsx (dev) and inside the esbuild single-file bundle (prod),
 * where reading .sql files relative to import.meta.url would break.
 *
 * The .sql files remain the human-readable source of truth — keep this file
 * in sync verbatim when adding a migration.
 */
export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    name: '001_init.sql',
    sql: `
-- Unified actors: human org members (actor_type='user') and API-key
-- pseudo-users (actor_type='api_key'). Departed members keep their rows
-- (in_roster=0) so history never loses attribution.
CREATE TABLE users (
  id                INTEGER PRIMARY KEY,
  actor_type        TEXT NOT NULL CHECK (actor_type IN ('user','api_key')),
  email             TEXT,
  api_key_name      TEXT,
  anthropic_user_id TEXT,
  name              TEXT NOT NULL DEFAULT '',
  role              TEXT,
  added_at          TEXT,
  in_roster         INTEGER NOT NULL DEFAULT 0,
  team_id           INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  first_seen_date   TEXT,
  last_seen_date    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX ux_users_email   ON users(email)        WHERE actor_type = 'user' AND email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_apikey  ON users(api_key_name) WHERE actor_type = 'api_key';
CREATE UNIQUE INDEX ux_users_anth_id ON users(anthropic_user_id) WHERE anthropic_user_id IS NOT NULL;
CREATE INDEX ix_users_team ON users(team_id);

CREATE TABLE teams (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color        TEXT NOT NULL DEFAULT '#6366f1',
  lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw API grain: one row per actor x terminal_type x customer_type x UTC day.
-- A user may have several rows per day; aggregates always SUM across them.
CREATE TABLE usage_daily (
  id             INTEGER PRIMARY KEY,
  date           TEXT NOT NULL,               -- 'YYYY-MM-DD' UTC
  user_id        INTEGER NOT NULL REFERENCES users(id),
  terminal_type  TEXT NOT NULL DEFAULT '',    -- '' when absent (NULL breaks UNIQUE)
  customer_type  TEXT NOT NULL DEFAULT '',
  num_sessions   INTEGER NOT NULL DEFAULT 0,
  lines_added    INTEGER NOT NULL DEFAULT 0,
  lines_removed  INTEGER NOT NULL DEFAULT 0,
  commits        INTEGER NOT NULL DEFAULT 0,
  pull_requests  INTEGER NOT NULL DEFAULT 0,
  edit_accepted        INTEGER NOT NULL DEFAULT 0,
  edit_rejected        INTEGER NOT NULL DEFAULT 0,
  multi_edit_accepted  INTEGER NOT NULL DEFAULT 0,
  multi_edit_rejected  INTEGER NOT NULL DEFAULT 0,
  write_accepted       INTEGER NOT NULL DEFAULT 0,
  write_rejected       INTEGER NOT NULL DEFAULT 0,
  notebook_accepted    INTEGER NOT NULL DEFAULT 0,
  notebook_rejected    INTEGER NOT NULL DEFAULT 0,
  raw_json       TEXT NOT NULL,               -- full API record; insurance for future columns
  synced_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (date, user_id, terminal_type, customer_type)
);
CREATE INDEX ix_usage_daily_date      ON usage_daily(date);
CREATE INDEX ix_usage_daily_user_date ON usage_daily(user_id, date);

CREATE TABLE usage_daily_models (
  id             INTEGER PRIMARY KEY,
  usage_daily_id INTEGER NOT NULL REFERENCES usage_daily(id) ON DELETE CASCADE,
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents     REAL NOT NULL DEFAULT 0      -- API float verbatim; round at display only
);
CREATE INDEX ix_udm_parent ON usage_daily_models(usage_daily_id);
CREATE INDEX ix_udm_model  ON usage_daily_models(model);

-- Hourly token activity from usage_report/messages grouped by account_id.
-- OAuth (Claude Code sign-in) traffic only; API-key traffic has no account_id.
CREATE TABLE usage_hourly (
  id           INTEGER PRIMARY KEY,
  hour_utc     TEXT NOT NULL,                 -- 'YYYY-MM-DDTHH:00:00Z'
  user_id      INTEGER NOT NULL REFERENCES users(id),
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, hour_utc)
);
CREATE INDEX ix_usage_hourly_hour ON usage_hourly(hour_utc);

CREATE TABLE sync_runs (
  id            INTEGER PRIMARY KEY,
  job_type      TEXT NOT NULL,   -- backfill | daily | hourly | roster | nightly
  trigger       TEXT NOT NULL,   -- cron | manual | startup
  status        TEXT NOT NULL,   -- running | success | error | cancelled
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT,
  error         TEXT
);
CREATE INDEX ix_sync_runs_type ON sync_runs(job_type, started_at DESC);

CREATE TABLE sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL    -- JSON-encoded
);

-- Yesterday's badge/segment snapshot per user, for "new badge" celebration
-- diffs and Top Movers.
CREATE TABLE score_snapshots (
  snapshot_date TEXT NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  range_key     TEXT NOT NULL,    -- e.g. '30d' — snapshots per range preset
  composite     REAL,
  segment       TEXT,
  badges_json   TEXT NOT NULL,    -- earned badge ids
  PRIMARY KEY (snapshot_date, user_id, range_key)
);
`,
  },
  {
    name: '002_costs_keys_dims.sql',
    sql: `
-- Invoice-grade daily cost line items from GET /v1/organizations/cost_report
-- (bucket_width=1d, grouped by workspace_id + description). SQLite UNIQUE
-- treats NULLs as distinct, so every dimension column stores '' instead of
-- NULL (same trick as usage_daily.terminal_type); workspace_id '' means the
-- default workspace. amount_cents keeps the API's decimal value verbatim —
-- round at display only.
CREATE TABLE cost_daily (
  id             INTEGER PRIMARY KEY,
  date           TEXT NOT NULL,                -- 'YYYY-MM-DD' UTC
  workspace_id   TEXT NOT NULL DEFAULT '',     -- '' = default workspace
  cost_type      TEXT NOT NULL DEFAULT 'other',
  token_type     TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT '',
  service_tier   TEXT NOT NULL DEFAULT '',
  context_window TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  amount_cents   REAL NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  UNIQUE (date, workspace_id, cost_type, token_type, model, service_tier, context_window, description)
);
CREATE INDEX ix_cost_daily_date ON cost_daily(date);

-- Org workspaces (GET /v1/organizations/workspaces, include_archived=true).
-- Full replace every sync run — names feed the cost byWorkspace breakdown.
CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,               -- wrkspc_...
  name          TEXT NOT NULL,
  display_color TEXT,
  archived_at   TEXT
);

-- API key inventory (GET /v1/organizations/api_keys). Full replace per run.
-- created_by_user_id is the Anthropic user_... id — resolved to a display
-- name via users.anthropic_user_id at query time.
CREATE TABLE api_keys (
  id                 TEXT PRIMARY KEY,          -- apikey_...
  name               TEXT NOT NULL,
  status             TEXT NOT NULL,             -- active | inactive | archived | expired
  partial_key_hint   TEXT,
  created_at         TEXT,
  created_by_user_id TEXT,                      -- anthropic user_... id
  workspace_id       TEXT                       -- NULL = default workspace
);

-- Per-key daily token usage (usage_report/messages grouped by api_key_id).
CREATE TABLE usage_api_keys_daily (
  id                    INTEGER PRIMARY KEY,
  date                  TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  api_key_id            TEXT NOT NULL,
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, api_key_id)
);
CREATE INDEX ix_uakd_date ON usage_api_keys_daily(date);

-- Org-level consumption slices (usage_report/messages grouped by
-- service_tier + context_window). '' = the API returned null for the slice.
CREATE TABLE usage_dimensions_daily (
  id                    INTEGER PRIMARY KEY,
  date                  TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  service_tier          TEXT NOT NULL DEFAULT '',
  context_window        TEXT NOT NULL DEFAULT '',
  uncached_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, service_tier, context_window)
);
CREATE INDEX ix_udd_date ON usage_dimensions_daily(date);

-- Server-side web search calls per user-hour (usage_report/messages
-- results[].server_tool_use.web_search_requests).
ALTER TABLE usage_hourly ADD COLUMN web_search_requests INTEGER NOT NULL DEFAULT 0;
`,
  },
  {
    name: '003_otel.sql',
    sql: `
-- Daily aggregates from Claude Code OpenTelemetry log events, ingested at
-- POST /otel/v1/logs (devs point OTEL_EXPORTER_OTLP_ENDPOINT at this server).
-- One row per UTC day x user x entity; counters only ever increment.

-- claude_code.skill_activated (+ api_request cost attribution via skill.name)
CREATE TABLE otel_skill_daily (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,                -- 'YYYY-MM-DD' UTC
  user_id     INTEGER NOT NULL REFERENCES users(id),
  skill_name  TEXT NOT NULL,
  invocations INTEGER NOT NULL DEFAULT 0,
  user_slash  INTEGER NOT NULL DEFAULT 0,   -- invocation_trigger='user-slash'
  proactive   INTEGER NOT NULL DEFAULT 0,   -- invocation_trigger='claude-proactive'
  nested      INTEGER NOT NULL DEFAULT 0,   -- invocation_trigger='nested-skill'
  cost_cents  REAL NOT NULL DEFAULT 0,      -- api_request cost_usd*100; round at display
  UNIQUE (date, user_id, skill_name)
);
CREATE INDEX ix_otel_skill_daily_date ON otel_skill_daily(date);

-- claude_code.tool_result where tool_name is Agent/Task (subagent_type from
-- tool_parameters JSON) + api_request cost attribution via agent.name
CREATE TABLE otel_agent_daily (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,              -- 'YYYY-MM-DD' UTC
  user_id       INTEGER NOT NULL REFERENCES users(id),
  subagent_type TEXT NOT NULL,
  invocations   INTEGER NOT NULL DEFAULT 0,
  success       INTEGER NOT NULL DEFAULT 0,
  failure       INTEGER NOT NULL DEFAULT 0,
  cost_cents    REAL NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, subagent_type)
);
CREATE INDEX ix_otel_agent_daily_date ON otel_agent_daily(date);

-- claude_code.tool_result (uses/success/failure) + claude_code.tool_decision
-- (accepted/rejected) for every tool, MCP tools included.
CREATE TABLE otel_tool_daily (
  id        INTEGER PRIMARY KEY,
  date      TEXT NOT NULL,                  -- 'YYYY-MM-DD' UTC
  user_id   INTEGER NOT NULL REFERENCES users(id),
  tool_name TEXT NOT NULL,
  uses      INTEGER NOT NULL DEFAULT 0,
  success   INTEGER NOT NULL DEFAULT 0,
  failure   INTEGER NOT NULL DEFAULT 0,
  accepted  INTEGER NOT NULL DEFAULT 0,
  rejected  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, tool_name)
);
CREATE INDEX ix_otel_tool_daily_date ON otel_tool_daily(date);
`,
  },
  {
    name: '004_enterprise.sql',
    sql: `
-- claude.ai Enterprise org-level daily summaries (GET analytics/summaries).
-- One row per UTC day; /api/adoption prefers these over usage_daily-derived
-- actives when rows exist (enterprise mode), and assigned_seat_count becomes
-- the rostered-users denominator (there is no seat-list endpoint).
CREATE TABLE org_summaries (
  date                 TEXT PRIMARY KEY,       -- 'YYYY-MM-DD' UTC
  assigned_seat_count  INTEGER NOT NULL DEFAULT 0,
  pending_invite_count INTEGER NOT NULL DEFAULT 0,
  dau                  INTEGER NOT NULL DEFAULT 0,
  wau                  INTEGER NOT NULL DEFAULT 0,
  mau                  INTEGER NOT NULL DEFAULT 0,
  claude_code_dau      INTEGER,                -- NULL when the API omits it
  raw_json             TEXT NOT NULL           -- full summary record; insurance for future columns
);
`,
  },
  {
    name: '005_user_tier.sql',
    sql: `
-- Program tier per member, observed from the claude_code usage report:
-- customer_type 'api' (Console org billing) vs 'subscription', and for
-- subscription users the plan (pro/max/team/enterprise). tier_as_of guards
-- updates so a backfill re-syncing old days never overwrites newer values.
ALTER TABLE users ADD COLUMN customer_type TEXT;
ALTER TABLE users ADD COLUMN subscription_type TEXT;
ALTER TABLE users ADD COLUMN tier_as_of TEXT;
`,
  },
  {
    name: '006_telemetry.sql',
    sql: `
-- Telemetry mode: the OTLP receiver becomes a first-class data source.
-- Metric deltas are ADDITIVE upserts (unlike the replace-day console sync), so
-- usage_daily_models first needs a real upsert key: coalesce any historical
-- duplicate (usage_daily_id, model) rows into the first row, then enforce
-- uniqueness.
UPDATE usage_daily_models AS m SET
  input_tokens = (SELECT SUM(d.input_tokens) FROM usage_daily_models d
                  WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  output_tokens = (SELECT SUM(d.output_tokens) FROM usage_daily_models d
                   WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  cache_read_tokens = (SELECT SUM(d.cache_read_tokens) FROM usage_daily_models d
                       WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  cache_creation_tokens = (SELECT SUM(d.cache_creation_tokens) FROM usage_daily_models d
                           WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model),
  cost_cents = (SELECT SUM(d.cost_cents) FROM usage_daily_models d
                WHERE d.usage_daily_id = m.usage_daily_id AND d.model = m.model)
WHERE m.id IN (
  SELECT MIN(id) FROM usage_daily_models GROUP BY usage_daily_id, model HAVING COUNT(*) > 1
);
DELETE FROM usage_daily_models WHERE id NOT IN (
  SELECT MIN(id) FROM usage_daily_models GROUP BY usage_daily_id, model
);
CREATE UNIQUE INDEX ux_udm_parent_model ON usage_daily_models(usage_daily_id, model);

-- claude_code.active_time.total (seconds) + session/prompt counters per UTC day.
CREATE TABLE otel_activity_daily (
  id            INTEGER PRIMARY KEY,
  date          TEXT NOT NULL,                -- 'YYYY-MM-DD' UTC
  user_id       INTEGER NOT NULL REFERENCES users(id),
  active_user_s REAL NOT NULL DEFAULT 0,      -- active_time.total{type=user}
  active_cli_s  REAL NOT NULL DEFAULT 0,      -- active_time.total{type=cli}
  prompts       INTEGER NOT NULL DEFAULT 0,
  sessions      INTEGER NOT NULL DEFAULT 0,   -- session.count
  UNIQUE (date, user_id)
);
CREATE INDEX ix_otel_activity_daily_date ON otel_activity_daily(date);

-- Hour-bucketed activity counters ('YYYY-MM-DDTHH:00:00Z', like usage_hourly).
CREATE TABLE otel_activity_hourly (
  id               INTEGER PRIMARY KEY,
  hour_utc         TEXT NOT NULL,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  prompts          INTEGER NOT NULL DEFAULT 0,
  api_requests     INTEGER NOT NULL DEFAULT 0,
  sessions_started INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, hour_utc)
);
CREATE INDEX ix_otel_activity_hourly_hour ON otel_activity_hourly(hour_utc);

-- One row per observed Claude Code session (pruned after 90 days).
CREATE TABLE otel_sessions (
  session_id     TEXT PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  date           TEXT NOT NULL,               -- 'YYYY-MM-DD' UTC of first event
  first_event_at TEXT NOT NULL,
  last_event_at  TEXT NOT NULL,
  events         INTEGER NOT NULL DEFAULT 0,
  prompts        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ix_otel_sessions_date_user ON otel_sessions(date, user_id);

-- API reliability per UTC day x user x model ('' when the model is unknown).
CREATE TABLE otel_reliability_daily (
  id                INTEGER PRIMARY KEY,
  date              TEXT NOT NULL,            -- 'YYYY-MM-DD' UTC
  user_id           INTEGER NOT NULL REFERENCES users(id),
  model             TEXT NOT NULL DEFAULT '',
  api_requests      INTEGER NOT NULL DEFAULT 0,
  api_errors        INTEGER NOT NULL DEFAULT 0,
  errors_429        INTEGER NOT NULL DEFAULT 0,
  errors_5xx        INTEGER NOT NULL DEFAULT 0,
  errors_other      INTEGER NOT NULL DEFAULT 0,
  refusals          INTEGER NOT NULL DEFAULT 0,
  compactions       INTEGER NOT NULL DEFAULT 0,
  internal_errors   INTEGER NOT NULL DEFAULT 0,
  total_duration_ms REAL NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, model)
);
CREATE INDEX ix_otel_reliability_daily_date ON otel_reliability_daily(date);

-- Permission decisions per UTC day x user, split by decision source.
CREATE TABLE otel_governance_daily (
  id                      INTEGER PRIMARY KEY,
  date                    TEXT NOT NULL,      -- 'YYYY-MM-DD' UTC
  user_id                 INTEGER NOT NULL REFERENCES users(id),
  src_config              INTEGER NOT NULL DEFAULT 0,
  src_hook                INTEGER NOT NULL DEFAULT 0,
  src_user_permanent      INTEGER NOT NULL DEFAULT 0,
  src_user_temporary      INTEGER NOT NULL DEFAULT 0,
  src_user_abort          INTEGER NOT NULL DEFAULT 0,
  src_user_reject         INTEGER NOT NULL DEFAULT 0,
  permission_mode_changes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id)
);

-- Which permission modes users switch into, per UTC day.
CREATE TABLE otel_permission_mode_daily (
  id      INTEGER PRIMARY KEY,
  date    TEXT NOT NULL,                      -- 'YYYY-MM-DD' UTC
  user_id INTEGER NOT NULL REFERENCES users(id),
  mode    TEXT NOT NULL,
  changes INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, mode)
);

-- MCP server ecosystem usage per UTC day x user x server.
CREATE TABLE otel_mcp_daily (
  id                  INTEGER PRIMARY KEY,
  date                TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  user_id             INTEGER NOT NULL REFERENCES users(id),
  server_name         TEXT NOT NULL,
  tool_calls          INTEGER NOT NULL DEFAULT 0,
  tool_failures       INTEGER NOT NULL DEFAULT 0,
  tokens              INTEGER NOT NULL DEFAULT 0,
  cost_cents          REAL NOT NULL DEFAULT 0,
  connections         INTEGER NOT NULL DEFAULT 0,
  connection_failures INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, server_name)
);
CREATE INDEX ix_otel_mcp_daily_date ON otel_mcp_daily(date);

-- Plugin installs/loads per UTC day x user x plugin.
CREATE TABLE otel_plugin_daily (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,                  -- 'YYYY-MM-DD' UTC
  user_id     INTEGER NOT NULL REFERENCES users(id),
  plugin_name TEXT NOT NULL,
  installs    INTEGER NOT NULL DEFAULT 0,
  loads       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, plugin_name)
);

-- Token/cost mix per UTC day x user x (model, speed, effort) — '' when absent.
CREATE TABLE otel_token_mix_daily (
  id         INTEGER PRIMARY KEY,
  date       TEXT NOT NULL,                   -- 'YYYY-MM-DD' UTC
  user_id    INTEGER NOT NULL REFERENCES users(id),
  model      TEXT NOT NULL DEFAULT '',
  speed      TEXT NOT NULL DEFAULT '',
  effort     TEXT NOT NULL DEFAULT '',
  tokens     INTEGER NOT NULL DEFAULT 0,
  cost_cents REAL NOT NULL DEFAULT 0,
  UNIQUE (date, user_id, model, speed, effort)
);

-- Ingest replay protection: SHA-256 of each raw OTLP request body, kept for
-- 15 minutes (exporter retries resend byte-identical bodies).
CREATE TABLE otel_ingest_dedup (
  hash        TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

-- Latest observed Claude Code app version per user (resource attr app.version),
-- guarded by cc_app_version_as_of so replayed old batches never downgrade it.
ALTER TABLE users ADD COLUMN cc_app_version TEXT;
ALTER TABLE users ADD COLUMN cc_app_version_as_of TEXT;
`,
  },
  {
    name: '007_user_country.sql',
    sql: `
-- Member location (ISO 3166-1 alpha-2), set from Manage teams. Nullable —
-- roster syncs never write it, so an admin's choice survives every sync.
ALTER TABLE users ADD COLUMN country TEXT;
`,
  },
];
