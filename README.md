# Claude Code Insights

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/zivhundert/claudedashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/zivhundert/claudedashboard/actions/workflows/ci.yml)
[![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-orange.svg)](pnpm-workspace.yaml)

A self-hosted dashboard for how your organization uses **Claude Code** — who's using it, which skills, agents and tools, how reliably, and what it costs — with a gamified leaderboard (segments, badges, streaks). **It works with any Claude Code setup**: because the default data source is Claude Code's own built-in OpenTelemetry export pushed straight to this server, you need **no enterprise account, no Admin API key, and no collector infrastructure** — Pro/Max seats, Team/Enterprise seats, API billing, even Bedrock/Vertex all show up the same way. If you *do* have a Console Admin key or a claude.ai Enterprise Analytics key, plug it in and the dashboard adds invoice-grade costs, org rosters and historical backfill on top. Everything runs on your own machine or VM: one Node process, one SQLite file, no login for viewers, and API keys never leave the server.

Modeled on [github-copilot-insights](https://github.com/zivhundert/github-copilot-insights).

## Two ways to run it

The dashboard wears one of two hats. Pick yours, set two or three lines of `.env`, and the server does the rest — the mode is auto-detected from which keys are present, or pinned explicitly with `DATA_SOURCE`.

### Hat 1 — Telemetry mode: any team, no special account *(default)*

For orgs **without** org-level Anthropic API access — Pro/Max seats, Team plan, or Claude Code running on **Bedrock/Vertex**. Claude Code's built-in OpenTelemetry exporter pushes usage straight to this server: no enterprise account, no Admin key, no collector infrastructure.

```bash
# .env — telemetry mode
DATA_SOURCE=telemetry                 # optional: this is the default when no key is set
DB_PATH=./data/telemetry.db
PRIVACY_MODE=balanced                 # minimal | balanced | full — see Privacy tiers
OTEL_INGEST_TOKEN=<openssl rand -hex 32>   # recommended: authenticates dev machines
```

Then roll one settings snippet out to each dev machine — see [Telemetry rollout](#telemetry-rollout--the-zero-requirements-mode). Trade-offs: history starts the day you roll out, costs are token-based estimates, and "users" means observed users (there's no roster API to compare against).

### Hat 2 — API mode: orgs with a Console or Enterprise account

For orgs that **do** have org-level API access, the dashboard pulls complete org data on a schedule — roster and seat counts, invoice-grade costs, and historical backfill from before the dashboard existed. Two flavors, one key each:

```bash
# .env — Console org (API-billed Claude Code)
# Key: Claude Console → Settings → Admin keys (org admin)
ADMIN_API_KEY=sk-ant-admin...
DB_PATH=./data/console.db
```

```bash
# .env — claude.ai Team/Enterprise seats
# Key: claude.ai → Organization settings → API (created by the org's PRIMARY OWNER)
ENTERPRISE_ANALYTICS_KEY=...
DB_PATH=./data/enterprise.db
```

**The hats compose.** An API-mode deployment that *also* rolls out telemetry gets the Skills & Agents, Activity, and Health packs on top of the API data — the ingest paths are single-writer per table and never double-count. Keep each mode on its own `DB_PATH` (core tables are owned by exactly one source).

There's also a **demo mode** (`pnpm seed && pnpm run dev:demo`) — a deterministic fake org with every feature lit up, no keys, no outbound calls.

### Capability matrix

Generated from one source of truth: [`shared/src/capabilities.ts`](shared/src/capabilities.ts).

| | **Telemetry** (default, recommended) | **Console** | **Enterprise** | **Demo** |
| --- | --- | --- | --- | --- |
| Requires | Nothing — devs point Claude Code's OTel export here | `ADMIN_API_KEY` (Console org admin) | `ENTERPRISE_ANALYTICS_KEY` (claude.ai primary owner) | Nothing (`pnpm seed`) |
| Core usage (overview, leaderboard, profiles) | ✅ | ✅ | ✅ | ✅ |
| Hourly activity / heatmaps | ✅ live | ✅ | ✅ | ✅ |
| Costs | estimated | billed + invoice-grade cost page | billed + invoice-grade cost page | estimated |
| Activity / Health / Skills telemetry packs | ✅ | ✅ when OTel also rolled out | with OTel rollout | ✅ (seeded) |
| Org roster & seat counts | observed users only | ✅ roster + seats | seats | ✅ |
| API-key inventory, service-tier & context-window mixes | — | ✅ | — | ✅ |
| Historical backfill (pre-install history) | — (history starts at rollout) | ✅ | ✅ (from 2026-01-01) | ✅ 180 days |
| Data freshness | ~5 seconds | ~1 hour lag | 1–3 days engagement, ~4 h costs | instant |
| Covers Bedrock / Vertex | ✅ | — | — | n/a |

## Quick start (demo, no keys)

```bash
pnpm install
pnpm seed          # deterministic fake org: 30 devs, 5 teams, 180 days of history
pnpm run dev:demo  # API on :8080 + web on :5173 (proxies /api)
```

Open http://localhost:5173. Demo mode disables the scheduler and all outbound API calls.

For real data, copy [.env.example](.env.example) to `.env` — it contains a ready-to-uncomment recipe for each hat, and every variable is documented. Hat 1 continues at [Telemetry rollout](#telemetry-rollout--the-zero-requirements-mode); for hat 2, first boot runs a resumable historical backfill — watch it in **Admin → Sync**; the dashboard is usable while it runs (Console data lags ~1 hour; Enterprise engagement lags 1–3 days and history starts 2026-01-01).

Either way, assign people to teams in **Admin → Manage teams** — Anthropic's APIs and telemetry have no team concept, so new users land in an "Unassigned" bucket.

## Telemetry rollout — the zero-requirements mode

Claude Code ships an OpenTelemetry exporter. Point it at this server and events arrive within seconds — no Anthropic account tier required, and it also covers Claude Code running on **Bedrock/Vertex**, which the Admin API can't see. The server accepts OTLP/HTTP JSON directly at `POST /otel/v1/logs` and `POST /otel/v1/metrics`.

> [!NOTE]
> **Coverage**: Claude Code exports telemetry from CLI, IDE-extension (VS Code/JetBrains), and SDK/CI sessions. The Claude Desktop app and claude.ai web sessions don't run the exporter — the dashboard measures coding-surface usage, not all Claude usage.

The full step-by-step team guide (per-OS paths, verification, troubleshooting) is in **[docs/telemetry-setup.md](docs/telemetry-setup.md)**. The short version — deploy one managed settings file per dev machine (users can't override it):

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux/WSL: `/etc/claude-code/managed-settings.json`
- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "otlp",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "http/json",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "delta",
    "OTEL_METRICS_INCLUDE_VERSION": "true",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://<dashboard-host>:8080/otel",
    "OTEL_LOG_TOOL_DETAILS": "1"
  }
}
```

> [!IMPORTANT]
> **IDE extension users: also set the user-level settings file.** Managed-settings coverage of the VS Code/JetBrains extension has been inconsistent across Claude Code versions, so the reliable cross-surface path is putting the same `env` block in `~/.claude/settings.json` — documented as shared between the extension and the CLI. Env vars are read at process startup, so **fully quit the IDE and reopen** ("Reload Window" is not enough), then confirm arrival via the dashboard's ingest counter on the Skills page.

### Privacy tiers

Every incoming record passes a privacy filter *before* anything is stored — set `PRIVACY_MODE` in the server's `.env`:

| Mode | What's kept |
| --- | --- |
| `minimal` | Counts and outcomes only; skill/agent/MCP/plugin names are bucketed (`custom_skill`, `mcp_tool`, …); prompt length dropped |
| `balanced` (default) | Names of skills/agents/tools plus counts, outcomes, models, tokens, cost; commands, file paths, arguments and prompt text dropped |
| `full` | Everything the exporter sends, including tool parameters (commands, file paths) |

Prompt and response **content is never collected** in any mode (Claude Code redacts it client-side by default). The exact policy the server executes is served at `GET /api/telemetry-policy` and rendered in-app as the **"What's collected"** transparency page — what devs see there is what runs, by construction. `OTEL_LOG_TOOL_DETAILS=1` is what reveals skill names and subagent types; it also includes Bash command lines in the payload (which `balanced`/`minimal` drop at ingest) — socialize that with the team before rollout.

Optional auth: set `OTEL_INGEST_TOKEN` in `.env` and add `"OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <token>"` to the settings snippet. Events carry `user.email`, so they join the same people you see everywhere else. Daily buckets use the org-local calendar day — `ORG_TIMEZONE`, default `Asia/Jerusalem` — matching the Sun–Thu workweek the score targets are built on, so work past midnight lands on the day you'd call it. Streaks follow `STREAK_MODE`: `workweek` (default) measures runs against the weekdays each person actually works, so their usual days off don't break one; `calendar` counts consecutive days and any gap ends a run. Badge thresholds live in `scoreTargets.streaks` because the same number costs more under `calendar` — a five-day week can never pass 5 there. Hour buckets stay UTC and are converted for display, and hour-bounded queries convert the local-day range rather than assuming the two line up. Rows ingested before this change are still keyed by UTC day. A batch larger than `OTEL_MAX_BODY_MB` (default 8) is rejected and counted in `otel_batch_too_large` — raise it if that counter climbs, but note that every accepted byte is parsed synchronously, so keep `OTEL_INGEST_TOKEN` set if the receiver is reachable beyond a trusted network. Only configured machines send data — the dashboard shows coverage as the rollout ramps.

## What it shows

| Page | For | Highlights |
| --- | --- | --- |
| **Overview** | Leadership | KPIs with deltas, activity/code-impact trends, cost by model, model & token mix, cache-efficiency gauge, when-we-work heatmap, Adoption × Impact quadrant, segment distribution, ROI cards, DAU/WAU/MAU pulse, org activity calendar |
| **Insights** | Leadership / leads | Celebration cards (promotions, new badges), inactive / declining / never-activated members, cache-leak & low-acceptance nudges with champion suggestions, non-adopter table |
| **Skills & Agents** | Everyone | Which skills (slash commands) and subagents the org uses, how skills get triggered (typed vs Claude-proactive), cost per skill, full tool usage, MCP servers, plugins, Claude Code version drift, skill power users — telemetry pack |
| **Activity** | Leads | Engaged time (hands-on vs Claude-working), prompts & sessions, session length distribution, live last-24h panel, per-person engagement — telemetry pack |
| **Health** | Platform owners | API errors over time, 429/5xx split, reliability by model, refusals & compactions, permission-decision sources (config/hook/user), permission-mode changes — telemetry pack |
| **Costs** | Leadership | Invoice-grade spend from the cost report (incl. web search & code execution), estimated-vs-actual reconciliation, cost by workspace & model, API-key inventory with per-key usage, service-tier mix, context-window mix |
| **Teams** | Leadership | Team-vs-team comparison (per-active-member normalized), team score radar |
| **Team page** | Team lead | Member table side-by-side (scores, trends, acceptance, cost), team heatmap, team insights, 2–5 member compare dialog |
| **My profile** | Developer | Composite score & org rank, score radar vs org median, 12-month activity calendar with streaks, badge case with progress bars, personal heatmap, model mix, personal trend |
| **Leaderboard** | Everyone | Global ranks with gold/silver/bronze, segment filters, top movers, shareable compare links |
| **Admin** | Dashboard owner | Team editor, sync status & manual triggers, settings |

Every view honors the global date-range picker and day/week/month granularity; all state lives in the URL, so any view can be shared as a link.

**Known caveats**: Admin API data lags ~1 hour and "today" is a partial day (Enterprise: 1–3 days); telemetry history only starts when the rollout does · Claude Code on Bedrock/Vertex is invisible to the Admin API (telemetry covers it) · PR counting requires GitHub tooling — in a non-GitHub org the Impact score automatically redistributes the PR weight and the PR badge shows "not applicable" · per-user cost is an estimate; the invoice-grade number is org-level on the Costs page (Console/Enterprise modes) · the display timezone is currently fixed (`web/src/lib/time.ts`) and Sun–Thu is hardcoded both as the score targets' workday count and as the no-history streak fallback (`shared/src/time/workweek.ts`) — making those configurable is a welcome first contribution (streaks themselves already learn each person's work week, or ignore it under `STREAK_MODE=calendar`).

## Screenshots

*(Demo mode — deterministic synthetic org.)*

**Org overview** — KPIs, activity & code-impact trends, cache efficiency, cost by model:

![Overview](docs/screenshots/overview.png)

**Skills & Agents** — the telemetry pack: top skills, how they get triggered, subagents, tool usage:

![Skills & Agents](docs/screenshots/skills.png)

**Leaderboard** — segments, badges, top movers:

![Leaderboard](docs/screenshots/leaderboard.png)

**Developer profile** — score radar, model mix, personal skills, streak calendar:

![My profile](docs/screenshots/profile.png)

## How scoring works

All formulas live in [shared/src/scoring](shared/src/scoring) — one source of truth executed on the server and reused by the UI for tooltips, so numbers can't drift. In short: four axis scores (Adoption, Impact, Efficiency, Trust), each scored against **fixed targets** (√ curve, capped at 100; volume targets are per-workday rates that scale with the selected range, admin-overridable in settings) — so a score is a pure function of that person's own work and one heavy user can never rescale anyone else's numbers → segments (Starter → Explorer → Producer → Champion) → badges, most percentile-based so they self-calibrate to org size, with small-sample reliability guards (e.g. acceptance rates under 20 decisions are low-confidence and down-weighted). Impact terms that fewer than 25% of active users can produce (trailing 90 days — e.g. PR counting is GitHub-only) redistribute their weight automatically. The in-app **Guide** (book icon, top right) documents every metric and rule in plain language.

## Deploy (Docker)

```bash
docker build -t claude-code-insights .
docker run -d --name claude-code-insights -p 8080:8080 \
  -v cci-data:/app/data --env-file .env claude-code-insights
```

One container: Node serves the built SPA + API on `PORT`; SQLite persists on the volume. A `HEALTHCHECK` hits `/api/health`. Without Docker: `pnpm build && pnpm start`.

The dashboard itself has **no authentication** — deploy it inside a trusted network or behind an SSO reverse proxy. See [SECURITY.md](SECURITY.md).

### Kubernetes / AKS (Helm)

A production Helm chart lives at [deploy/helm/claude-code-insights](deploy/helm/claude-code-insights) — single replica by design (SQLite, RWO disk), one PVC, health probes, optional ingest-token Secret, and internal-LB/ingress exposure options documented in its `values.yaml`. The full walkthrough (ACR build, install, backups, air-gapped path) is in [docs/deploy-aks.md](docs/deploy-aks.md); for offline clusters, [scripts/build-offline-bundle.sh](scripts/build-offline-bundle.sh) packages the image + chart + install guide into one transferable tarball.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | server (`:8080`, tsx watch) + web (`:5173`, Vite HMR) |
| `pnpm run dev:demo` | same, with `DEMO_MODE=1` |
| `pnpm seed` | reset + seed the demo database (`data/dashboard.db`) |
| `pnpm build` | typecheck-build all packages → `server/dist` + `web/dist` |
| `pnpm start` | production: single Node process serving SPA + API |
| `pnpm test` | scoring-engine unit tests (vitest) |
| `pnpm typecheck` | strict TS across all packages |

## Architecture

```
shared/   API contract types + capability matrix + scoring engine + unit tests
server/   Fastify + better-sqlite3 + node-cron sync engine + OTLP receiver
web/      Vite + React + Tailwind v4 + ECharts SPA
data/     dashboard.db (gitignored; Docker volume in production)
```

Deep dive: [docs/architecture.md](docs/architecture.md).

## Contributing & license

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the workspace setup and the contract-first change pattern, and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

[MIT](LICENSE) © 2026 Ziv Hundert
