# Architecture

One Node process (Fastify), one SQLite file, one React SPA. The server pulls (or receives) usage data into local aggregate tables; the web app is a pure consumer of `/api/*`. Nothing leaves your infrastructure, and API keys never reach the browser.

```
┌────────────────────────┐   pull (cron)   ┌─────────────────────────────┐
│ Anthropic Admin API /  │ ──────────────▶ │  server/  Fastify + SQLite  │
│ Enterprise Analytics   │                 │  ├─ sync engine (SyncPlan)  │
└────────────────────────┘                 │  ├─ OTLP receiver /otel/*   │
┌────────────────────────┐   push (OTLP)   │  ├─ scoring (from shared/)  │
│ Claude Code exporters  │ ──────────────▶ │  └─ REST /api/*             │
│ on every dev machine   │                 └──────────────┬──────────────┘
└────────────────────────┘                                │
                                           ┌──────────────▼──────────────┐
                                           │  web/  Vite + React SPA     │
                                           └─────────────────────────────┘
```

## Monorepo layout

pnpm workspaces, strict TypeScript everywhere (`noUncheckedIndexedAccess` on):

| Package | Path | What lives there |
| --- | --- | --- |
| `@dash/shared` | `shared/` | **The contract.** Every `/api/*` request/response type (`src/types.ts`), the data-source capability matrix (`src/capabilities.ts`), the telemetry privacy-policy types, the entire scoring engine (`src/scoring/`), work-week math (`src/time/` — pure functions; the server resolves `ORG_TIMEZONE`, `WORKWEEK` and `WEEK_START` once at boot and passes them in, and serves them read-only to the web app via `/api/settings`), and the unit tests (`test/`). Server and web both import from here — change contracts here first, never inline. |
| `@dash/server` | `server/` | Fastify app (`src/app.ts`, `src/routes/`), better-sqlite3 repos (`src/repos/`), migrations (`src/db/migrations/*.sql`), Anthropic API clients (`src/anthropic/`), the sync engine (`src/sync/`), and the OTLP receiver (`src/otel/`, `src/routes/otel.ts`). |
| `@dash/web` | `web/` | Vite + React + Tailwind v4 + ECharts SPA. Pages under `src/pages/`, shared cards/charts under `src/components/`, typed fetch layer in `src/lib/api.ts`. All view state lives in the URL. |

## Modes and SyncPlans

`server/src/env.ts` resolves the data source from `.env` (override with `DATA_SOURCE`): demo wins; then `ENTERPRISE_ANALYTICS_KEY` → `enterprise`; then `ADMIN_API_KEY` → `console`; with no key at all the OTLP push receiver is the source — **keyless boot is valid** (`telemetry` mode).

The sync engine is one `SyncManager` (`server/src/sync/manager.ts`) driving a `SyncPlan` — a strategy interface with a single `runJob(run, onProgress, log)` over the job types `backfill | daily | hourly | roster | nightly`:

- **`ConsoleSyncPlan`** (`sync/consolePlan.ts`) — pulls the Console Admin API: per-user daily Claude Code usage, hourly activity, cost report, API keys, dimensions, roster. First boot runs a resumable historical backfill (walks backwards until `BACKFILL_START` or an empty streak).
- **`EnterpriseSyncPlan`** (`sync/enterprise.ts`) — pulls the claude.ai Enterprise Analytics API instead (seats, billed spend; engagement lags 1–3 days, which the plan handles).
- **`TelemetrySyncPlan`** (`sync/telemetryPlan.ts`) — there is no upstream to pull; data arrives via push. Every pull-shaped job is a no-op by design, and the nightly job is pure housekeeping: score snapshots + retention pruning (sessions 90 days, dedup hashes 15 minutes).
- **Demo** — `pnpm seed` writes deterministic synthetic data and the scheduler never starts.

Scheduling: a nightly cron (`SYNC_CRON` in `SYNC_TZ`, which defaults to `ORG_TIMEZONE`) plus an intraday refresh every `INTRADAY_SYNC_MINUTES`; Admin → Sync can trigger any job manually and streams a live log.

What each mode unlocks in the UI is a pure function in `shared/src/capabilities.ts`, served at `GET /api/capabilities` — the web app gates pages/cards on it rather than sniffing for empty data. In console/enterprise mode the server flips `telemetryPacks` to true once OTel events have actually been ingested, so the packs compose onto API modes.

## OTLP ingest (`/otel/v1/logs` + `/otel/v1/metrics`)

Claude Code's built-in exporter POSTs OTLP/HTTP JSON straight to the server — no collector. Shared behavior for both endpoints (`server/src/routes/otel.ts`):

- **Auth**: optional `OTEL_INGEST_TOKEN` → `Authorization: Bearer` check, 401 otherwise.
- **Privacy choke point**: every record's attributes pass `sanitize()` (`server/src/otel/privacy.ts`) **before any handler runs**. The policy is *data* (per-event keep/drop/redact rules selected by `PRIVACY_MODE`), `sanitize` is its only interpreter, and the identical policy object is served at `GET /api/telemetry-policy` for the in-app transparency dialog — what devs are shown is what executes, by construction.
- **Dedup**: each raw request body is SHA-256 hashed; hashes are remembered for 15 minutes (`otel_ingest_dedup`) so exporter retries never double-count.
- **Batch aggregation**: a whole POST is folded into one delta per `(date, user, entity)` and written in **one transaction**, including the dedup check and `sync_state` watermarks (`otel_events_ingested`, `otel_last_event_at`).
- **Identity**: events carry `user.email`; an `EmailUserResolver` maps emails to `users` rows (creating observed-only users in telemetry mode), so telemetry joins the same people as API data.
- **Defensive parsing**: malformed nodes are skipped, never 500 — an exporter must not be able to wedge ingest.

**Logs** (`routes/otel.ts`) handle the event stream — `skill_activated`, `tool_result`/`tool_decision`, `api_request`/`api_error`/`api_refusal`, `user_prompt`, `compaction`, `internal_error`, `permission_mode_changed`, `mcp_server_connection`, `plugin_installed/loaded` — and feed the `otel_*` pack tables.

**Metrics** (`otel/metrics.ts`) handle the counters — sessions, lines of code, commits, PRs, edit-tool decisions, tokens, cost, active time. Only **delta-temporality** sums are accepted (cumulative datapoints are dropped and counted). Two write classes:

- **core** `usage_daily` / `usage_daily_models` / `usage_hourly` — written **only** in telemetry mode (in console/enterprise those tables belong to the API sync; additive deltas would double-count);
- **packs** `otel_activity_*`, `otel_mcp_daily`, `otel_token_mix_daily` and the per-user `app.version` observation — written in **every** mode.

## SQLite schema families

Migrations are plain SQL files in `server/src/db/migrations/`, applied in order at boot. Repos (`server/src/repos/`) are the only SQL surface. Aggregates are **deltas/upserts keyed by (date, user, dimension)** — no raw event storage except the short-lived session tracker.

| Family | Tables | Fed by |
| --- | --- | --- |
| Core usage | `usage_daily`, `usage_daily_models`, `usage_hourly` | API sync (console/enterprise) or OTLP metrics (telemetry mode) |
| Usage dimensions | `usage_api_keys_daily`, `usage_dimensions_daily` | Console Admin API |
| Telemetry packs | `otel_skill_daily`, `otel_agent_daily`, `otel_tool_daily`, `otel_activity_daily`, `otel_activity_hourly`, `otel_reliability_daily`, `otel_governance_daily`, `otel_permission_mode_daily`, `otel_mcp_daily`, `otel_plugin_daily`, `otel_token_mix_daily`, `otel_sessions`, `otel_ingest_dedup` | OTLP push (every mode) |
| Cost / org | `cost_daily`, `api_keys`, `workspaces`, `org_summaries` | Console cost report / Enterprise analytics |
| People / app | `users`, `teams`, `settings`, `score_snapshots`, `sync_runs`, `sync_state` | Roster sync, Admin UI, nightly snapshots, sync bookkeeping |

## Scoring engine

All formulas live in `shared/src/scoring/` — executed on the server (`server/src/services/scoring.ts`) to build leaderboards, and imported by the web app for tooltips and the in-app Guide, so displayed explanations can't drift from computed numbers. Pipeline: per-user metrics → four axis scores (Adoption, Impact, Efficiency, Trust), each scored against fixed targets (`targets.ts`: per-workday rates × the range's workdays per `WORKWEEK`, √ curve capped at 100 in `normalize.ts`; admin-overridable via `settings.scoreTargets`) → composite score → segments (`scores.ts`, champion at ≥80/≥80) → badges, mostly percentile-based with small-sample reliability guards (`badges.ts`; a few are measured over history rather than the selected range — streaks, and Deep Diver's all-time compaction count — so an earned achievement doesn't vanish when the date picker narrows); metric/badge copy lives in `catalog.ts`. Axis scores are pure functions of the user's own row — no org max in any denominator, so one person's volume can't move anyone else's score. Git-derived Impact terms are coverage-gated: a term fewer than 25% of active users produced over a trailing-90d window (deliberately range-independent, so weights don't flip with the date picker — PR counting is GitHub-only) redistributes its weight to the kept terms. Nightly `score_snapshots` power Top Movers and celebration cards. Unit tests: `shared/test/scoring.test.ts`.
