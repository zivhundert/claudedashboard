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
      'Personal page → Coach: AI feedback on how you work with Claude Code — a short summary, your strengths, and 3–5 recommendations on adoption, efficiency, quality, toolkit (skills, subagents, MCP servers) and delivery, each citing your own numbers and naming a concrete Claude Code practice to try. No scores, rankings or org comparisons: you, on your own terms. Needs a range of 7 days or more.',
      'Works with any Anthropic-compatible endpoint: a Claude deployment on Microsoft Foundry, or another model behind a proxy such as LiteLLM (e.g. GPT-5.6). Set FOUNDRY_BASE_URL, FOUNDRY_API_KEY, FOUNDRY_MODEL and AI_PROVIDER_LABEL; the card does not exist without a key.',
      'Coach notes are cached per person for a day; Regenerate asks the model again (rate-limited). The card footer, “What’s collected” and the boot banner name the actual provider and model, and state that only numbers are sent — never prompts, code or file names.',
      'Admin → Settings → AI coach: on/off switch (turning it back on needs the admin password), the model’s $/M-token prices, and a usage & estimated-cost table (today / 7d / 30d / all time).',
      'Admin → Settings → AI coach prompt: rewrite the coaching guidance (tone, priorities, house practices) behind an admin password; the output format stays locked and cached notes are cleared on save.',
      'Misconfigured coach endpoints fail loudly: one tiny check at boot, the reason in the banner and in /api/capabilities, and the card shows “AI coach misconfigured: …” with precise error codes (model_not_deployed, auth_failed, unreachable, no_metrics_for_range, …) instead of a misleading “user not found”.',
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
