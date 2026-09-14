/**
 * Release notes shown from the sidebar version badge ("What's new"). Newest
 * first. Add an entry whenever the root package.json version is bumped — the
 * highlights are user-facing, one line each, no internals.
 */
export interface ReleaseNote {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  highlights: string[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '1.0.7',
    date: '2026-09-14',
    highlights: [
      'AI coach, reframed around you: no scores, rankings or org comparisons any more. The coach reads only your own numbers — activity, output, edit decisions per tool, cost and cache, and the skills, subagents and MCP servers you actually use (with failure rates) — and gives feedback on working with Claude Code more effectively across five areas: adoption, efficiency, quality, toolkit and delivery. It needs a range of 7 days or more.',
      'Settings → AI coach: an on/off switch (turning it back on requires the admin password), the model’s $/M-token prices, and a usage & estimated-cost table (today / 7d / 30d / all time) fed by a ledger of every model call.',
      'Skill catalog: run `pnpm skills:scan` on a machine with your skills installed and the Skills page gains each skill’s description, source badge (personal / project / plugin), version and allowed tools — in the filter, the bar tooltips, the top-skill chips and the detail card — plus a footer saying how much of what ran is described.',
      'Active users are counted the same way everywhere: any Claude Code activity on a day (sessions, edits, lines, commits or PRs) counts, so the Overview number, the trend bars, adoption %, streaks and the “see who” list finally agree. The numbers go up slightly — sessions that ran past midnight used to be missed.',
      'The selected date range, granularity and team now stay put when you move between pages instead of falling back to 30D.',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-09-13',
    highlights: [
      'New: AI coach on the Personal page. From your metrics it writes a short summary, one or two strengths and 3–5 recommendations, each citing the numbers it relied on and naming a concrete Claude Code practice to try.',
      'How it works: notes are generated on first view and cached per person and range for a day (regenerated only when the numbers or the prompt change); Regenerate asks the model again, rate-limited. Only numbers leave the server — never names, prompts, code or file names — and “What’s collected” states when the coach is on and which provider and model answer.',
      'Configuration: works with any Anthropic-format endpoint — a Claude deployment on Microsoft Foundry, or another model behind a proxy such as LiteLLM (e.g. GPT-5.6). Set FOUNDRY_API_KEY, FOUNDRY_BASE_URL, FOUNDRY_MODEL and AI_PROVIDER_LABEL; one check at boot reports in the banner and /api/capabilities whether the endpoint, key and model are reachable, and the card explains any misconfiguration instead of hiding.',
      'Admin → Settings → AI coach prompt: rewrite the coaching guidance behind an admin password; the output format stays locked and cached notes are cleared on save.',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-09-10',
    highlights: [
      'Click any skill, subagent, tool, MCP server or plugin name for its detail card: what it is (source, kind, plugin, marketplace), numbers for the range, first/last seen, daily trend, related items you can hop to, and the people behind it.',
      'Telemetry now records where each skill comes from (source, definition kind, plugin, marketplace) — see “What’s collected”.',
      'Activity-trend drawer: people sorted by most recent activity, with each person’s real last event time.',
    ],
  },
  {
    version: '1.0.4',
    date: '2026-09-09',
    highlights: [
      'Overview → Activity trend: click any bar to see who was active that day, week or month — and who was not.',
      'Release notes: click the version badge in the sidebar to open this list.',
    ],
  },
  {
    version: '1.0.3',
    date: '2026-09-09',
    highlights: [
      'Member location: set each person’s country from Manage teams (Israel, Ukraine, Armenia, Spain, USA, Georgia, Poland).',
      'Country flags next to names on the Leaderboard, in the hover card and in the profile header.',
    ],
  },
  {
    version: '1.0.2',
    date: '2026-09-07',
    highlights: [
      'Personal page rebuilt as a review story: Scorecard → Rhythm → Toolkit → Health & governance → Cost & efficiency → Achievements.',
      'All telemetry now available per person: tools, MCP, plugins, Claude Code version, reliability, governance, cost & cache trend.',
      'New “Today” range preset.',
      'Live today: click an hour to see who was active.',
      'Fixed legend text overlapping the axis names on dual-axis charts.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-09-07',
    highlights: [
      'View as Personal / Team / Org (formerly Developer / Team Lead / Director), with “Who am I” and “My team” always editable.',
      'Personal page: composite-score explanation and last-active time to the minute.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-06',
    highlights: [
      'Version number shown in the sidebar, boot banner and API.',
      'Telemetry receiver can run on its own port (OTEL_PORT) so only it needs to be reachable from dev machines.',
    ],
  },
];
