import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, GitCompareArrows } from 'lucide-react';
import { GUARDS, SEGMENT_ORDER, type LeaderboardEntry } from '@dash/shared';
import { Avatar } from '@/components/Avatar';
import { CountryFlag } from '@/components/CountryFlag';
import { SegmentChip } from '@/components/SegmentChip';
import { BadgeIcon } from '@/components/BadgeIcon';
import { ConfidenceDot } from '@/components/ConfidenceDot';
import { DeltaChip } from '@/components/DeltaChip';
import { Sparkline } from '@/components/Sparkline';
import { UserHoverCard, profilePath } from '@/components/UserHoverCard';
import { Button } from '@/components/ui';
import { fmtCost, fmtNumber, fmtPct, fmtSigned, relativeDate, daysSince } from '@/lib/format';
import { cn } from '@/lib/utils';

type SortKey =
  | 'name'
  | 'segment'
  | 'composite'
  | 'trend'
  | 'sessions'
  | 'netLines'
  | 'acceptance'
  | 'commits'
  | 'cost'
  | 'badges'
  | 'lastActive'
  | 'team';

const segmentRank = (e: LeaderboardEntry) => SEGMENT_ORDER.indexOf(e.segment);

const SORTERS: Record<SortKey, (e: LeaderboardEntry) => number | string> = {
  name: (e) => e.user.name.toLowerCase(),
  team: (e) => (e.user.teamName ?? '').toLowerCase(),
  segment: (e) => -segmentRank(e),
  composite: (e) => e.scores.composite ?? -1,
  trend: (e) => e.trendDeltaPct ?? -Infinity,
  sessions: (e) => e.metrics.sessions,
  netLines: (e) => e.metrics.linesAdded - e.metrics.linesRemoved,
  acceptance: (e) => e.metrics.acceptanceRate ?? -1,
  commits: (e) => e.metrics.commits + e.metrics.pullRequests,
  cost: (e) => e.metrics.costCents,
  badges: (e) => e.badges.filter((b) => b.earned).length,
  lastActive: (e) => e.lastActiveDate ?? '',
};

function CompositeRing({ value }: { value: number | null }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const frac = value === null ? 0 : Math.min(1, Math.max(0, value / 100));
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90" aria-hidden="true">
        <circle cx="10" cy="10" r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
          strokeDasharray={`${(frac * c).toFixed(1)} ${c.toFixed(1)}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={cn('text-sm font-semibold', value === null && 'text-muted')}>
        {value === null ? '—' : Math.round(value)}
      </span>
    </span>
  );
}

function Th({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey?: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sortKey !== undefined && sort.key === sortKey;
  return (
    <th
      className={cn(
        'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
      )}
    >
      {sortKey ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={cn(
            'inline-flex items-center gap-0.5 uppercase tracking-wider transition-colors hover:text-fg',
            active && 'text-fg',
          )}
        >
          {label}
          {active && (sort.dir === -1 ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

const RANK_TINTS = [
  'color-mix(in srgb, #eab308 9%, transparent)',
  'color-mix(in srgb, #94a3b8 9%, transparent)',
  'color-mix(in srgb, #b45309 9%, transparent)',
];

export function MemberTable({
  entries,
  rankEntries,
  showTeam = false,
  showRank = false,
  onCompare,
}: {
  entries: LeaderboardEntry[];
  /** entries to compute ranks/medals from (defaults to `entries`); pass the
   *  unfiltered list so ranks stay global when `entries` is filtered. */
  rankEntries?: LeaderboardEntry[];
  showTeam?: boolean;
  showRank?: boolean;
  /** receives 2-5 selected user emails */
  onCompare?: (emails: string[]) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'composite', dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === -1 ? 1 : -1 }
        : { key, dir: key === 'name' || key === 'team' ? 1 : -1 },
    );

  const rankOf = useMemo(() => {
    const byComposite = [...(rankEntries ?? entries)].sort(
      (a, b) => (b.scores.composite ?? -1) - (a.scores.composite ?? -1),
    );
    const map = new Map<number, number>();
    byComposite.forEach((e, i) => map.set(e.user.id, i + 1));
    return map;
  }, [rankEntries, entries]);

  const sorted = useMemo(() => {
    const sorter = SORTERS[sort.key];
    return [...entries].sort((a, b) => {
      const av = sorter(a);
      const bv = sorter(b);
      const cmp =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return cmp * sort.dir;
    });
  }, [entries, sort]);

  const toggle = (email: string | null) => {
    if (!email) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else if (next.size < 5) next.add(email);
      return next;
    });
  };

  return (
    <div className="relative">
      {onCompare && selected.size >= 2 && (
        <div className="absolute -top-1 right-0 z-10 -translate-y-full pb-2">
          <Button variant="primary" onClick={() => onCompare([...selected])}>
            <GitCompareArrows size={13} /> Compare ({selected.size})
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {onCompare && <th className="w-8 px-2.5 py-2" />}
              {showRank && <Th label="#" sort={sort} onSort={onSort} />}
              <Th label="Member" sortKey="name" sort={sort} onSort={onSort} />
              {showTeam && <Th label="Team" sortKey="team" sort={sort} onSort={onSort} />}
              <Th label="Segment" sortKey="segment" sort={sort} onSort={onSort} />
              <Th label="Composite" sortKey="composite" sort={sort} onSort={onSort} />
              <Th label="Trend" sortKey="trend" sort={sort} onSort={onSort} />
              <Th label="Sessions" sortKey="sessions" sort={sort} onSort={onSort} align="right" />
              <Th label="Net lines" sortKey="netLines" sort={sort} onSort={onSort} align="right" />
              <Th label="Accept." sortKey="acceptance" sort={sort} onSort={onSort} align="right" />
              <Th label="Cmt/PR" sortKey="commits" sort={sort} onSort={onSort} align="right" />
              <Th label="Cost" sortKey="cost" sort={sort} onSort={onSort} align="right" />
              <Th label="Badges" sortKey="badges" sort={sort} onSort={onSort} />
              <Th label="Last active" sortKey="lastActive" sort={sort} onSort={onSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((e) => {
              const netLines = e.metrics.linesAdded - e.metrics.linesRemoved;
              const earned = e.badges.filter((b) => b.earned);
              const rank = rankOf.get(e.user.id) ?? 0;
              const idle = daysSince(e.lastActiveDate);
              const cache = e.metrics.cacheRatio;
              return (
                <tr
                  key={e.user.id}
                  className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]"
                  style={
                    showRank && rank >= 1 && rank <= 3
                      ? { background: RANK_TINTS[rank - 1] }
                      : undefined
                  }
                >
                  {onCompare && (
                    <td className="px-2.5 py-2">
                      <input
                        type="checkbox"
                        checked={e.user.email !== null && selected.has(e.user.email)}
                        disabled={e.user.email === null}
                        onChange={() => toggle(e.user.email)}
                        className="size-3.5 accent-[var(--accent)]"
                        aria-label={`Select ${e.user.name} for comparison`}
                      />
                    </td>
                  )}
                  {showRank && (
                    <td className="px-2.5 py-2 text-xs font-semibold text-muted">
                      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
                    </td>
                  )}
                  <td className="max-w-52 px-2.5 py-2">
                    <UserHoverCard entry={e}>
                      <Link to={profilePath(e)} className="flex min-w-0 items-center gap-2 hover:underline">
                        <Avatar name={e.user.name} email={e.user.email} size={26} />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium">{e.user.name}</span>
                            <CountryFlag code={e.user.country} />
                          </span>
                          <span className="block truncate text-[10.5px] text-muted">
                            {e.user.email ?? e.user.apiKeyName ?? ''}
                          </span>
                        </span>
                      </Link>
                    </UserHoverCard>
                  </td>
                  {showTeam && (
                    <td className="px-2.5 py-2 text-xs text-muted">
                      {e.user.teamId != null ? (
                        <Link to={`/team/${e.user.teamId}`} className="hover:text-fg hover:underline">
                          {e.user.teamName}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="px-2.5 py-2">
                    <SegmentChip tier={e.segment} />
                  </td>
                  <td className="px-2.5 py-2">
                    <CompositeRing value={e.scores.composite} />
                  </td>
                  <td className="px-2.5 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkline data={e.sparkline} width={72} height={22} fill={false} />
                      <DeltaChip deltaPct={e.trendDeltaPct} tooltip="Sessions: last 14d vs prior 14d" />
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px]">
                    {fmtNumber(e.metrics.sessions)}
                    <span
                      className="text-muted"
                      title="Active days (incl. weekends) / Sun–Thu workdays"
                    >
                      {' '}
                      · {e.metrics.activeDays}/{e.metrics.workdays}d
                    </span>
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-2.5 py-2 text-right text-[13px] font-medium',
                      netLines > 0 ? 'text-good' : netLines < 0 ? 'text-risk' : 'text-muted',
                    )}
                  >
                    {fmtSigned(netLines)}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px]">
                    {fmtPct(e.metrics.acceptanceRate)}
                    {e.scores.trustLowConfidence && (
                      <ConfidenceDot
                        className="ml-1"
                        reason={`fewer than ${GUARDS.minToolEvents} tool decisions`}
                      />
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px]">
                    {fmtNumber(e.metrics.commits)}
                    <span className="text-muted"> / </span>
                    {fmtNumber(e.metrics.pullRequests)}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right">
                    <span className="text-[13px]">{fmtCost(e.metrics.costCents)}</span>
                    <span
                      title={`Cache efficiency: ${fmtPct(cache)}`}
                      className="mt-0.5 block h-[3px] w-full min-w-10 overflow-hidden rounded-full bg-fg/10"
                    >
                      <span
                        className={cn('block h-full rounded-full', (cache ?? 0) >= 0.6 ? 'bg-good' : 'bg-warn')}
                        style={{ width: `${Math.round((cache ?? 0) * 100)}%` }}
                      />
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    <span className="inline-flex items-center gap-1">
                      {earned.slice(0, 4).map((b) => (
                        <BadgeIcon key={b.id} badge={b} />
                      ))}
                      {earned.length > 4 && (
                        <span className="text-[11px] text-muted">+{earned.length - 4}</span>
                      )}
                      {earned.length === 0 && <span className="text-[11px] text-muted">—</span>}
                    </span>
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap px-2.5 py-2 text-right text-xs',
                      idle !== null && idle >= 7 ? 'font-medium text-risk' : 'text-muted',
                    )}
                  >
                    {relativeDate(e.lastActiveDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && (
        <div className="py-10 text-center text-xs text-muted">No members in this range.</div>
      )}
    </div>
  );
}
