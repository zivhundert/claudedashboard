# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Report privately via [GitHub Security Advisories](https://github.com/zivhundert/claude-code-insights/security/advisories/new) ("Report a vulnerability"). You'll get an acknowledgement as soon as possible, and a fix or mitigation plan before any public disclosure.

## Deployment model — read this before exposing the dashboard

**The dashboard has no authentication or authorization of its own.** Anyone who can reach the HTTP port can read every page (per-user usage, costs, emails) and use the Admin screens. This is by design for a small trusted team, and it means you must:

- deploy inside a trusted network (VPN/private subnet), **or**
- put it behind an authenticating reverse proxy (SSO/OAuth2 proxy), and
- never expose the port to the public internet.

## Telemetry ingest

The OTLP receiver (`POST /otel/v1/logs`, `POST /otel/v1/metrics`) accepts pushes from developer machines.

- **Set `OTEL_INGEST_TOKEN`** (e.g. `openssl rand -hex 32`) in the server's `.env` unless the server is only reachable from a trusted network. With it set, both endpoints require `Authorization: Bearer <token>` and reply 401 otherwise; developers add the matching `OTEL_EXPORTER_OTLP_HEADERS` entry (see [docs/telemetry-setup.md](docs/telemetry-setup.md)). The server logs a boot warning when running keyless telemetry mode without a token.
- Ingest is defensive by construction: malformed payloads are skipped (never 500), and request bodies are SHA-256-deduped so replayed/retried batches don't double-count.

## Privacy filter design

Telemetry can contain sensitive detail (Bash command lines, file paths — and prompt text, if a client machine explicitly opts in). The server's stance:

- **Drop at ingest, not at display.** Every record passes the privacy filter (`server/src/otel/privacy.ts`) *before any handler or table sees it*. What the policy drops is never stored anywhere.
- **Policy as data.** The keep/drop/redact rules for each event type are a plain data object selected by `PRIVACY_MODE` (`minimal` / `balanced` / `full`), with a single interpreter function. There is no second code path to drift.
- **Transparency endpoint.** `GET /api/telemetry-policy` serves the exact policy object the ingest path executes, and the web app renders it as the "What's collected" dialog — users see precisely what is collected, by construction.
- The default (`balanced`) drops prompt text, commands, file paths and tool arguments. Prompt/response content is additionally redacted client-side by Claude Code's exporter unless a machine opts in — and only `PRIVACY_MODE=full` would store it.

## AI coach (optional LLM feature)

When `FOUNDRY_API_KEY` is set, opening a Personal page sends that person's **metrics only** (numbers — never names, emails, prompts, code or file names) to the configured Anthropic-format endpoint — your Claude deployment on Microsoft Foundry, or an Anthropic-compatible proxy such as LiteLLM in front of another model — and stores the returned recommendations in SQLite (`ai_recommendations`, alongside the exact input that was sent, for audit). Set `AI_PROVIDER_LABEL` so the disclosure names what actually answers; a proxy on a private network may be plain `http`, so treat the API key it carries as network-scoped.

- The model's output is schema-validated and every metric it cites is checked against the input before display; nothing it invents is shown.
- Because the dashboard has no authentication, anyone who can reach it can trigger generations. Spend is bounded by design: results are cached per person and range (default 24h) and only regenerated when the numbers change; Regenerate is limited to one per 10 minutes per person and 120 generations per hour overall; concurrent requests for the same person share one call; people with no activity get a canned answer without a model call.
- The transparency page ("What's collected") states that the feature is on, which provider and model, and the cache window. Turning it off is removing the key.
- Error bodies from the coach routes carry a classified code and an operator message that may name the endpoint host and model (never the key) — e.g. `deployment "x" does not exist at proxy:3000`. Anyone who can open the dashboard can see them; that is consistent with the no-auth deployment model above.
- The coach's guidance text is editable from Settings, gated by `ADMIN_PASSWORD` (sent as the `x-admin-password` header on the single `PUT /api/coach/prompt` route, compared in constant time, never stored in the browser). The output contract the parser depends on is not editable. Without `ADMIN_PASSWORD` the editor is read-only.

## Secrets handling

- `ADMIN_API_KEY`, `ENTERPRISE_ANALYTICS_KEY`, `OTEL_INGEST_TOKEN`, `FOUNDRY_API_KEY`, and `ADMIN_PASSWORD` live only in the server's `.env` (or your secret manager / `--env-file`). They are read server-side and **never reach the browser or any API response**.
- `.env` and `.env.local` are gitignored (and dockerignored) — verify before committing config changes: `git check-ignore -v .env`. Commit only `.env.example`, which must never contain real values.
- The SQLite database (`data/`, also gitignored) contains usage data and user emails — treat backups of it with the same care as the dashboard itself.
