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
