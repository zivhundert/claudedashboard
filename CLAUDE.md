# Claude Code Insights — working notes

## Languages
The API contract and all scoring formulas live in `shared/src` — change them there, never inline.

## Local development / running the app
- Before starting any dev server, check the port first (`lsof -i :<port>`) and kill lingering processes from prior runs. Default ports: server 8080 (override with `PORT` in `.env` if something else holds it), Vite 5173. The Vite dev proxy reads `PORT` from the root `.env`, so the two stay in sync automatically.
- Never re-seed (`pnpm seed`) while a server is holding the SQLite database open — stop servers first, or the running server reads a stale WAL snapshot.
- `pnpm run dev:demo` = seeded demo mode (no API key); real mode reads `.env` (never print `ADMIN_API_KEY` / `ENTERPRISE_ANALYTICS_KEY`).

## Answering questions
When answering questions about the stack, versions, or dependencies, cite the source file/location that confirms the answer.
