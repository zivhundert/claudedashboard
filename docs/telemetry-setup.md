# Telemetry rollout guide

Claude Code has a built-in OpenTelemetry exporter. Point it at your Claude Code Insights server and the **Skills & Agents**, **Activity**, and **Health** pages light up — no Anthropic enterprise account, no Admin API key, and no OTel collector needed. The server accepts OTLP/HTTP JSON directly:

- `POST /otel/v1/logs` — events (prompts, tool results, skill activations, API requests/errors, permission decisions, MCP connections, plugin loads)
- `POST /otel/v1/metrics` — counters (sessions, lines of code, commits, PRs, edit-tool decisions, tokens, cost, active time)

Events typically arrive within ~5 seconds of the activity. In **telemetry mode** (no API key configured) this feed also powers the core usage pages; in Console/Enterprise mode it adds the telemetry packs on top of the API sync without double-counting.

## What's covered (and what isn't)

Claude Code runs the OTel exporter in its **CLI, IDE-extension (VS Code / JetBrains), and SDK/headless (CI) entrypoints** — those sessions all report here once configured. Two surfaces do **not** export telemetry, no matter how they're configured:

- the **Claude Desktop app** — its agent sessions don't apply the exporter env (verified empirically; the [monitoring docs](https://code.claude.com/docs/en/monitoring-usage) list only CLI/SDK/IDE entrypoints), and
- **claude.ai web / mobile sessions** — they execute on Anthropic's cloud, where machine-level configuration doesn't exist.

Read the dashboard accordingly: it measures coding-surface usage, not all Claude usage.

## 1. Decide what you collect: privacy tiers

Set `PRIVACY_MODE` in the server's `.env` (`minimal` | `balanced` | `full`, default `balanced`). Every incoming record is filtered **at ingest, before anything is stored** — the policy is data, executed at a single choke point, and the exact policy object is served at `GET /api/telemetry-policy` and shown to every viewer in the in-app **"What's collected"** transparency dialog.

In **every** mode:

- Prompt and response **content is never collected** — Claude Code redacts prompt text client-side by default, and `balanced`/`minimal` drop it server-side even if a machine opted into prompt logging.
- Events carry `user.email` and `session.id` — the dashboard is per-user by design. Tell your team that.

### `balanced` (default)

| Event | What's kept | What's dropped |
| --- | --- | --- |
| `user_prompt` | prompt length + timing | prompt text |
| `tool_result` | tool name, success/failure | `tool_parameters` filtered to `skill_name`/`subagent_type` only — commands, file paths, arguments dropped |
| `tool_decision` | which tool was allowed/rejected, and by what (config, hook, user) | — |
| `api_request` | model, token counts, cost, duration; skill/agent names for cost attribution | — |
| `api_error` | model, status code, duration | — |
| `skill_activated` | skill name, how it was triggered (typed `/`, proactive, nested), and where it came from (source, definition kind, plugin, marketplace) | — |
| `at_mention` | counted only | mention target |
| everything else | operational counters and dimension names | prompt text; `tool_parameters` filtered |

### `minimal` — balanced minus names

| Event | Difference vs balanced |
| --- | --- |
| `user_prompt` | prompt **length** also dropped (timing only) |
| `tool_result` / `tool_decision` | built-in tool names kept; every other tool becomes the `custom_tool` / `mcp_tool` bucket |
| `api_request` / `skill_activated` | skill/agent names bucketed to `custom_skill` / `custom` |
| MCP server / plugin names | bucketed to `redacted` |

Use this when the org wants adoption/reliability numbers but skill and MCP names are considered sensitive. Per-server MCP attribution naturally disappears with the names.

### `full`

Keeps **everything the exporter sends**, including full `tool_parameters` (commands, file paths, arguments) and — if a machine explicitly opted in client-side via `OTEL_LOG_USER_PROMPTS` — prompt text. Only use on a locked-down server with team consent.

## 2. Configure the server

```bash
# .env on the dashboard host
PRIVACY_MODE=balanced

# strongly recommended outside a trusted network:
OTEL_INGEST_TOKEN=<long-random-string>     # e.g. openssl rand -hex 32
```

When `OTEL_INGEST_TOKEN` is set, both `/otel/*` endpoints require `Authorization: Bearer <token>` and reply `401` otherwise. Without it, the receiver accepts unauthenticated POSTs (the server logs a warning at boot in telemetry mode).

## 3. Configure developer machines

### Option A — managed settings (fleet rollout, terminal CLI)

Deploy one file per machine (users can't override it):

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Linux / WSL: `/etc/claude-code/managed-settings.json`
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

(A copy lives at [managed-settings.example.json](../managed-settings.example.json); the in-app telemetry setup card shows the same snippet with a copy button.)

Line by line:

- `OTEL_LOGS_EXPORTER=otlp` — the event stream: skills, agents, tools, errors, governance.
- `OTEL_METRICS_EXPORTER=otlp` — the counters: sessions, lines of code, commits/PRs, tokens, cost, active time. In telemetry mode these fill the core usage tables.
- `OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=delta` — **required**; the server only accepts delta sums (cumulative datapoints would double-count on every export and are dropped, counted in `sync_state.otel_metrics_dropped_cumulative`).
- `OTEL_METRICS_INCLUDE_VERSION=true` — adds `app.version`, which feeds the **Version drift** card.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — no trailing `/v1/...`; the exporter appends `/v1/logs` and `/v1/metrics` itself. The port is the server's `PORT` (default 8080), or `OTEL_PORT` if the server runs the receiver on a dedicated listener — in that case `/otel/*` is no longer served on `PORT`.
- `OTEL_LOG_TOOL_DETAILS=1` — this is what reveals **skill names and subagent types**. It also puts Bash command lines into the payload — `balanced`/`minimal` drop them at ingest, but they do transit the wire, so socialize this with the team before rollout.

If you set `OTEL_INGEST_TOKEN` on the server, add the matching header:

```json
    "OTEL_EXPORTER_OTLP_HEADERS": "Authorization=Bearer <token>"
```

### Option B — user settings (individuals, and all IDE users)

> [!IMPORTANT]
> **IDE extension coverage of managed settings has been inconsistent across Claude Code versions** — some builds of the VS Code/JetBrains extension have not applied `managed-settings.json` even though the terminal CLI does. Don't assume; verify with the ingest counter (below) after a full IDE restart.

Put the exact same `env` block in a loaded source instead:

- User-wide: `~/.claude/settings.json` (recommended — applies everywhere)
- Per-project: `.claude/settings.json`

Env vars are read at process startup: restart terminal sessions, and for IDEs **fully quit the IDE (Cmd+Q) and reopen** — "Reload Window" is not enough.

## 4. Verify it's flowing

1. On a configured machine, restart Claude Code and run a few prompts/tool calls.
2. The **Skills & Agents** page header shows the ingest counter: *"N events ingested · last event X ago"* — it should climb within seconds. The **Activity** page's **Live today** panel shows the last 24 h in near-real-time.
3. Or check the database on the dashboard host:

```bash
sqlite3 data/dashboard.db "SELECT key,value FROM sync_state WHERE key LIKE 'otel%';"
# otel_events_ingested should climb; otel_last_event_at should be recent
sqlite3 data/dashboard.db "SELECT date,tool_name,uses FROM otel_tool_daily ORDER BY date DESC LIMIT 10;"
```

4. Confirm the receiver is reachable from a dev machine (`200` = up; `401` = up but your token header is missing/wrong):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<dashboard-host>:8080/otel/v1/logs \
  -H 'Content-Type: application/json' -d '{}'
```

## Troubleshooting: nothing arrives

- **Sessions weren't restarted.** Env vars only apply to Claude Code processes started *after* the config landed. Restart terminals; fully quit + reopen IDEs.
- **IDE users with only the managed file.** See Option B — the extension ignores managed settings.
- **Wrong port/host.** The endpoint must be the server's `PORT` (default 8080) — or `OTEL_PORT` when that is set, since the receiver then leaves `PORT` — and reachable from dev machines: run the `curl` check above from one of them. Remember: no `/v1/logs` suffix in `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **Token mismatch.** If the server has `OTEL_INGEST_TOKEN` set, missing/typo'd `OTEL_EXPORTER_OTLP_HEADERS` yields 401s (visible in server logs). The header value format is `Authorization=Bearer <token>`.
- **Metrics arrive but usage stays empty.** Check the temporality flag — cumulative datapoints are dropped (see `sync_state.otel_metrics_dropped_cumulative`).
- **Events counted but a page stays empty.** `minimal` mode intentionally buckets names; the Skills page will show `custom_skill`/`mcp_tool` buckets rather than real names.
- Timestamps are UTC — late-night work can land on the "wrong" calendar day compared to local-time expectations. That's by design.

Only configured machines send data; the dashboard reflects coverage as the rollout ramps, so partial numbers early on are expected.
