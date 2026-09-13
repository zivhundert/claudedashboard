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
    version: '1.0.6',
    date: '2026-09-13',
    highlights: [
      'New: AI coach on the Personal page. For ranges of 7 days or more, the coach reads that person’s own numbers — activity, output, edit decisions per tool, cost and cache, and the skills, subagents and MCP servers they use — and writes a short summary, one or two strengths and 3–5 recommendations for working with Claude Code more effectively (adoption, efficiency, quality, toolkit, delivery). Each item cites the numbers it relied on and names a concrete Claude Code practice to try. It looks at the developer on their own terms: no scores, rankings or comparisons to the organisation.',
      'How it works: notes are generated on first view and cached per person and range for a day (regenerated only when the numbers or the prompt change); Regenerate asks the model again, rate-limited. Only numbers leave the server — never names, prompts, code or file names — and “What’s collected” states when the coach is on and which provider and model answer.',
      'Configuration: works with any Anthropic-format endpoint — a Claude deployment on Microsoft Foundry, or another model behind a proxy such as LiteLLM (e.g. GPT-5.6). Set FOUNDRY_API_KEY, FOUNDRY_BASE_URL, FOUNDRY_MODEL and AI_PROVIDER_LABEL; one check at boot reports in the banner and /api/capabilities whether the endpoint, key and model are reachable, and the card explains any misconfiguration instead of hiding.',
      'Admin controls (Settings → AI coach): an on/off switch (turning it back on requires ADMIN_PASSWORD), the model’s $/M-token prices and a usage & estimated-cost table (today / 7d / 30d / all time), plus an editable coaching prompt behind the same password — the output format stays locked.',
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
