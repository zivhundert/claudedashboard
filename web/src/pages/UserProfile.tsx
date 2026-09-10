import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { Flame, Trophy } from 'lucide-react';
import {
  BADGE_CATALOG,
  GUARDS,
  type CalendarDay,
  type LeaderboardEntry,
  type ModelUsage,
  type TimeseriesResponse,
  type UserProfileResponse,
} from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useCapabilities, useHeatmap, useLeaderboard, useSkills, useTimeseries, useUserProfile } from '@/lib/queries';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtCost, fmtTokens, relativeDate, relativeDateTime } from '@/lib/format';
import { toast } from '@/state/toast';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import {
  ActivityCalendar,
  CALENDAR_METRIC_OPTIONS,
  type CalendarMetric,
} from '@/components/ActivityCalendar';
import { WhenWorkCard } from '@/components/WhenWorkCard';
import {
  PersonalActivitySection,
  PersonalCostSection,
  PersonalHealthSection,
  PersonalToolkitSection,
} from '@/components/PersonalTelemetry';
import { SectionHeader } from '@/components/SectionHeader';
import { AcceptanceByToolChart, perToolTotal } from '@/components/AcceptanceByTool';
import { Avatar } from '@/components/Avatar';
import { CountryFlag } from '@/components/CountryFlag';
import { EntityName } from '@/components/EntityName';
import { SegmentChip } from '@/components/SegmentChip';
import { ConfidenceDot } from '@/components/ConfidenceDot';
import { DeltaChip } from '@/components/DeltaChip';
import { Sparkline } from '@/components/Sparkline';
import { Skeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { InfoPopover, Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function UserProfile() {
  const { email: emailParam } = useParams<{ email: string }>();
  const email = emailParam ?? '';
  const { from, to, gran } = useRangeParams();
  const [split, setSplit] = useState<'none' | 'terminal' | 'model'>('none');

  const profileQ = useUserProfile(email, { from, to });
  const leaderboardQ = useLeaderboard({ from, to });
  const timeseriesQ = useTimeseries(email, { from, to, split });
  const profile = profileQ.data;
  const heatmapQ = useHeatmap({ from, to, userId: profile?.user.id }, profile !== undefined);
  const caps = useCapabilities().data?.capabilities;

  // confetti for newly earned badges
  useEffect(() => {
    if (!profile) return;
    const idKey = profile.user.email ?? String(profile.user.id);
    const storageKey = `dash-badges-seen:${idKey}`;
    let seen: string[] = [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) seen = JSON.parse(raw) as string[];
    } catch {
      /* corrupted storage — treat as empty */
    }
    const seenSet = new Set(seen);
    const earned = profile.entry.badges.filter((b) => b.earned).map((b) => b.id);
    const fresh = earned.filter((id) => !seenSet.has(id));
    if (fresh.length > 0) {
      void confetti({ particleCount: 120, spread: 75, origin: { y: 0.25 }, disableForReducedMotion: true });
      const names = fresh.map((id) => BADGE_CATALOG[id].name).join(', ');
      toast(`New badge${fresh.length > 1 ? 's' : ''}: ${names}`, 'success', 'Check the badge case below 🎉');
      // Union rather than replace: a badge that drops out of the current range
      // (and later reappears) must not re-fire confetti.
      localStorage.setItem(storageKey, JSON.stringify([...seen, ...fresh]));
    }
  }, [profile]);

  const rank = useMemo(() => {
    const entries = leaderboardQ.data?.entries;
    if (!entries || !profile) return null;
    const sorted = [...entries].sort(
      (a, b) => (b.scores.composite ?? -1) - (a.scores.composite ?? -1),
    );
    const idx = sorted.findIndex((e) => e.user.id === profile.user.id);
    return idx >= 0 ? { rank: idx + 1, of: sorted.length } : null;
  }, [leaderboardQ.data, profile]);

  if (profileQ.isLoading) {
    return (
      <div className="space-y-4">
        <div className="card flex items-center gap-4 p-5">
          <Skeleton className="size-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-3.5 w-72" />
          </div>
          <Skeleton className="h-12 w-24" />
        </div>
        <div className="grid grid-cols-12 gap-4">
          <Skeleton className="col-span-12 h-72 lg:col-span-5" />
          <Skeleton className="col-span-12 h-72 lg:col-span-7" />
        </div>
      </div>
    );
  }
  if (profileQ.error) {
    return <ErrorCard error={profileQ.error} onRetry={() => void profileQ.refetch()} />;
  }
  if (!profile) return null;

  const entry = profile.entry;

  return (
    <ChartPage pageId="profile">
      <div className="grid grid-cols-12 gap-4">
        <ProfileHeader profile={profile} rank={rank} />

        {/* 1 · Scorecard — where the composite comes from */}
        <SectionHeader title="Scorecard" />
        <ChartCard
          title="Score radar"
          chartId="score-radar"
          metricKey="scoreRadar"
          subtitle="You vs the org median"
          className="col-span-12 md:col-span-6 lg:col-span-4"
          isLoading={leaderboardQ.isLoading}
          error={leaderboardQ.error}
          onRetry={() => void leaderboardQ.refetch()}
        >
          {(ref) => (
            <ScoreRadar
              instanceRef={ref}
              entry={entry}
              orgMedian={leaderboardQ.data?.orgMedianScores ?? { adoption: 0, impact: 0, efficiency: 0, trust: 0 }}
            />
          )}
        </ChartCard>
        <ChartCard
          title="Acceptance by tool"
          chartId="profile-acceptance"
          metricKey="acceptanceByTool"
          subtitle={
            entry.scores.trustLowConfidence
              ? `Low confidence — fewer than ${GUARDS.minToolEvents} decisions`
              : 'Edits kept vs rejected — the Trust axis'
          }
          className="col-span-12 md:col-span-6 lg:col-span-4"
          isEmpty={perToolTotal(entry.metrics.perTool) === 0}
          emptyText="No tool decisions in this range"
        >
          {(ref) => <AcceptanceByToolChart instanceRef={ref} perTool={entry.metrics.perTool} />}
        </ChartCard>
        <ChartCard
          title="Model mix"
          chartId="model-donut"
          metricKey="modelMix"
          subtitle="Tokens by model; hover for cost"
          className="col-span-12 lg:col-span-4"
          isEmpty={profile.models.length === 0}
          emptyText="No model usage in this range"
        >
          {(ref) => <ModelDonut instanceRef={ref} models={profile.models} />}
        </ChartCard>

        {/* 2 · Rhythm — consistency, volume, when, and right now */}
        <SectionHeader title="Rhythm" />
        <ActivityCalendarCard calendar={profile.calendar} streak={entry.streak} />
        <ChartCard
          title="Personal trend"
          chartId="personal-trend"
          metricKey="personalTrend"
          subtitle="Sessions over time"
          actions={
            <Segmented
              size="xs"
              options={[
                { id: 'none' as const, label: 'Total' },
                { id: 'terminal' as const, label: 'By terminal' },
                { id: 'model' as const, label: 'By model' },
              ]}
              value={split}
              onChange={setSplit}
            />
          }
          className="col-span-12 lg:col-span-7"
          isLoading={timeseriesQ.isLoading}
          error={timeseriesQ.error}
          onRetry={() => void timeseriesQ.refetch()}
          isEmpty={!!timeseriesQ.data && timeseriesQ.data.points.length === 0}
        >
          {(ref) => <PersonalTrend instanceRef={ref} ts={timeseriesQ.data} gran={gran} />}
        </ChartCard>
        <WhenWorkCard
          title="When I work"
          chartId="profile-heatmap"
          hours={heatmapQ.data?.hours ?? []}
          isLoading={heatmapQ.isLoading || profile === undefined}
          error={heatmapQ.error}
          onRetry={() => void heatmapQ.refetch()}
          className="col-span-12 lg:col-span-5"
        />
        <PersonalActivitySection userId={profile.user.id} from={from} to={to} gran={gran} />

        {/* 3 · Toolkit — how this person works with Claude */}
        <SectionHeader title="Toolkit" />
        <SkillsAgentsCard userId={profile.user.id} from={from} to={to} />
        <PersonalToolkitSection
          userId={profile.user.id}
          from={from}
          to={to}
          gran={gran}
          terminalMix={profile.terminalMix}
          showSurfaces={caps?.terminalMix !== false}
        />

        {/* 4 · Health & governance — renders its own header (hidden without telemetry packs) */}
        <PersonalHealthSection userId={profile.user.id} from={from} to={to} gran={gran} />

        {/* 5 · Cost & efficiency */}
        <SectionHeader title="Cost & efficiency" />
        <PersonalCostSection
          userId={profile.user.id}
          from={from}
          to={to}
          gran={gran}
          tokensDaily={profile.tokensDaily}
        />

        {/* 6 · Achievements — always last */}
        <SectionHeader title="Achievements" />
        <BadgeCase entry={entry} />

        <HiddenChartChips />
      </div>
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function ProfileHeader({
  profile,
  rank,
}: {
  profile: UserProfileResponse;
  rank: { rank: number; of: number } | null;
}) {
  const { user, entry } = profile;
  const composite = entry.scores.composite;
  // Program tier from the usage report: subscription plan name, or API billing.
  const tierLabel = user.subscriptionType
    ? `${user.subscriptionType.charAt(0).toUpperCase()}${user.subscriptionType.slice(1)} plan`
    : user.customerType === 'api'
      ? 'API billing'
      : null;
  return (
    <header className="card col-span-12 flex flex-col gap-4 p-5 md:flex-row md:items-center">
      <div className="flex items-center gap-4">
        <Avatar name={user.name} email={user.email} size={64} />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{user.name}</h1>
            <CountryFlag code={user.country} size="md" />
            <SegmentChip tier={entry.segment} size="md" />
          </div>
          <div className="mt-1 text-xs text-muted">
            {user.email ?? user.apiKeyName}
            {user.teamName && <> · {user.teamName}</>}
            {user.role && <> · {user.role}</>}
            {tierLabel && (
              <>
                {' · '}
                <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent">{tierLabel}</span>
              </>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1 font-medium text-warn">
              <Flame size={13} />
              {entry.streak.current} day{entry.streak.current === 1 ? '' : 's'} streak
              <span className="font-normal text-muted">(best {entry.streak.best})</span>
            </span>
            {rank && (
              <span className="inline-flex items-center gap-1 font-medium">
                <Trophy size={13} className="text-tier-champion" />#{rank.rank}
                <span className="font-normal text-muted">of {rank.of} in the org</span>
              </span>
            )}
            <span className="text-muted">
              last active{' '}
              {profile.lastActiveAt ? relativeDateTime(profile.lastActiveAt) : relativeDate(entry.lastActiveDate)}
            </span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6 md:ml-auto">
        <div className="flex items-center gap-2">
          <Sparkline data={entry.sparkline} width={110} height={34} />
          <DeltaChip deltaPct={entry.trendDeltaPct} tooltip="Sessions: last 14d vs prior 14d" />
        </div>
        <div className="text-right">
          <div className={cn('text-5xl font-bold leading-none tracking-tight', composite !== null && 'hero-gradient')}>
            {composite === null ? '—' : Math.round(composite)}
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">
            <span className="inline-flex items-center gap-1">
              composite score
              <InfoPopover metricKey="composite" />
            </span>
            {composite === null && <span className="block">needs ≥ {GUARDS.minActiveDays} active days</span>}
          </div>
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Radar / donut / trend
// ---------------------------------------------------------------------------

function ScoreRadar({
  instanceRef,
  entry,
  orgMedian,
}: {
  instanceRef: ChartRef;
  entry: LeaderboardEntry;
  orgMedian: { adoption: number; impact: number; efficiency: number; trust: number };
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: { backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.fg, fontSize: 12 } },
      legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      radar: {
        indicator: [
          { name: 'Adoption', max: 100 },
          { name: 'Impact', max: 100 },
          { name: 'Efficiency', max: 100 },
          { name: 'Trust', max: 100 },
        ],
        radius: '65%',
        axisName: { color: t.muted, fontSize: 11 },
        splitLine: { lineStyle: { color: t.border } },
        splitArea: { areaStyle: { color: ['transparent'] } },
        axisLine: { lineStyle: { color: t.border } },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 3,
          data: [
            {
              name: entry.user.name,
              value: [entry.scores.adoption, entry.scores.impact, entry.scores.efficiency, entry.scores.trust],
              lineStyle: { color: t.accent, width: 2.5 },
              itemStyle: { color: t.accent },
              areaStyle: { color: t.accent, opacity: 0.15 },
            },
            {
              name: 'Org median',
              value: [orgMedian.adoption, orgMedian.impact, orgMedian.efficiency, orgMedian.trust],
              lineStyle: { color: t.muted, width: 1.5, type: 'dashed' },
              itemStyle: { color: t.muted },
              areaStyle: { color: t.muted, opacity: 0.05 },
            },
          ],
        },
      ],
    };
  }, [entry, orgMedian, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-64" />;
}

function ModelDonut({ instanceRef, models }: { instanceRef: ChartRef; models: ModelUsage[] }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const costByModel = new Map(models.map((m) => [m.model, m.costCents]));
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          const cost = costByModel.get(p.name ?? '') ?? 0;
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b><br/>${fmtTokens(typeof p.value === 'number' ? p.value : 0)} tokens (${p.percent ?? 0}%)<br/>Cost: ${fmtCost(cost)}`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'middle',
        textStyle: { color: t.muted, fontSize: 10.5 },
        icon: 'circle',
        itemWidth: 8,
        formatter: (name: string) => (name.length > 22 ? `${name.slice(0, 20)}…` : name),
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['35%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data: models.map((m) => ({
            name: m.model,
            value: m.tokens.input + m.tokens.output + m.tokens.cacheRead + m.tokens.cacheCreation,
          })),
        },
      ],
    };
  }, [models, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-64" />;
}

function PersonalTrend({
  instanceRef,
  ts,
  gran,
}: {
  instanceRef: ChartRef;
  ts: TimeseriesResponse | undefined;
  gran: 'day' | 'week' | 'month';
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const points = ts?.points ?? [];
    const keys =
      ts && ts.split !== 'none' ? [...new Set(points.map((p) => p.key ?? 'unknown'))].sort() : [null];
    const buckets = bucketRows(points, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
      },
      legend:
        keys.length > 1
          ? { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8, type: 'scroll' }
          : undefined,
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        name: 'sessions',
        nameTextStyle: { color: t.muted, fontSize: 10 },
        axisLabel: { color: t.muted, fontSize: 10.5 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: keys.map((key, i) => ({
        name: key ?? 'Sessions',
        type: 'bar' as const,
        stack: keys.length > 1 ? 'split' : undefined,
        barMaxWidth: 24,
        itemStyle: {
          color: keys.length > 1 ? t.palette[i % t.palette.length] : t.accent,
          borderRadius: keys.length > 1 ? 0 : [3, 3, 0, 0],
          opacity: 0.9,
        },
        data: buckets.map((b) =>
          sumBy(
            b.rows.filter((p) => key === null || (p.key ?? 'unknown') === key),
            (p) => p.sessions,
          ),
        ),
      })),
    };
  }, [ts, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

function ActivityCalendarCard({
  calendar,
  streak,
}: {
  calendar: CalendarDay[];
  streak: { current: number; best: number };
}) {
  const [metric, setMetric] = useState<CalendarMetric>('sessions');
  return (
    <ChartCard
      title="Activity calendar"
      chartId="activity-calendar"
      metricKey="activityCalendar"
      infoExtra="Trailing 12 months of activity, independent of the selected range."
      subtitle={`🔥 Current streak ${streak.current} days · best ${streak.best}`}
      actions={
        <Segmented size="xs" options={CALENDAR_METRIC_OPTIONS} value={metric} onChange={setMetric} />
      }
      className="col-span-12"
      isEmpty={calendar.length === 0}
      emptyText="No activity in the last 12 months"
    >
      {(ref) => <ActivityCalendar instanceRef={ref} data={calendar} metric={metric} />}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Skills & agents (Claude Code telemetry)
// ---------------------------------------------------------------------------

const isRedactedSkill = (name: string) => name === 'custom_skill' || name === 'third-party';

function SkillsAgentsCard({ userId, from, to }: { userId: number; from: string; to: string }) {
  const skillsQ = useSkills({ from, to, userId });
  const data = skillsQ.data;
  const noTelemetry = !!data && (!data.hasData || (data.skills.length === 0 && data.agents.length === 0));

  const topSkills = useMemo(
    () => [...(data?.skills ?? [])].sort((a, b) => b.invocations - a.invocations),
    [data],
  );
  const maxInvocations = topSkills[0]?.invocations ?? 0;

  const agents = useMemo(
    () => [...(data?.agents ?? [])].sort((a, b) => b.invocations - a.invocations),
    [data],
  );
  const maxAgentInvocations = agents[0]?.invocations ?? 0;
  const agentSuccess = useMemo(() => {
    let weighted = 0;
    let known = 0;
    for (const a of agents) {
      if (a.successRate !== null) {
        weighted += a.successRate * a.invocations;
        known += a.invocations;
      }
    }
    return known > 0 ? Math.round((weighted / known) * 100) : null;
  }, [agents]);

  return (
    <ChartCard
      title="Skills & agents"
      chartId="profile-skills"
      metricKey="skillsUsage"
      subtitle="Everything invoked in the selected date range — change the range to see other dates"
      className="col-span-12"
      noExport
      isLoading={skillsQ.isLoading}
      error={skillsQ.error}
      onRetry={() => void skillsQ.refetch()}
      isEmpty={noTelemetry}
      emptyText="No telemetry from this user yet"
    >
      <div className="flex flex-col gap-5 py-1 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            Skills ({topSkills.length})
          </div>
          {topSkills.length === 0 ? (
            <div className="text-xs text-muted">No skill invocations in this range.</div>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
              {topSkills.map((s) => (
                <li key={s.skillName} className="flex items-center gap-2.5">
                  <EntityName
                    kind="skill"
                    name={s.skillName}
                    className={cn('w-44 shrink-0 font-mono text-[11.5px]', isRedactedSkill(s.skillName) && 'text-muted')}
                    title={isRedactedSkill(s.skillName) ? 'name redacted by telemetry settings — details' : undefined}
                  />
                  <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
                    <span
                      className="block h-full rounded-full bg-accent"
                      style={{
                        width: `${maxInvocations > 0 ? Math.max(2, Math.round((s.invocations / maxInvocations) * 100)) : 0}%`,
                      }}
                    />
                  </span>
                  <span className="w-12 shrink-0 text-right text-xs text-muted">
                    {s.invocations.toLocaleString('en-US')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0 shrink-0 md:w-80">
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            Subagents ({agents.length})
          </div>
          {agents.length === 0 ? (
            <div className="text-xs text-muted">No subagent runs in this range.</div>
          ) : (
            <>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {agents.map((a) => (
                  <li key={a.subagentType} className="flex items-center gap-2.5">
                    <EntityName kind="agent" name={a.subagentType} className="w-40 shrink-0 font-mono text-[11.5px]" />
                    <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{
                          width: `${maxAgentInvocations > 0 ? Math.max(2, Math.round((a.invocations / maxAgentInvocations) * 100)) : 0}%`,
                        }}
                      />
                    </span>
                    <span className="w-12 shrink-0 text-right text-xs text-muted">
                      {a.invocations.toLocaleString('en-US')}
                    </span>
                  </li>
                ))}
              </ul>
              {data && (
                <div className="mt-1.5 text-[11px] text-muted">
                  {data.totals.agentInvocations.toLocaleString('en-US')} runs ·{' '}
                  {fmtCost(data.totals.agentCostCents)}
                  {agentSuccess !== null && ` · ${agentSuccess}% success`}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Badge case
// ---------------------------------------------------------------------------

function BadgeCase({ entry }: { entry: LeaderboardEntry }) {
  const earnedCount = entry.badges.filter((b) => b.earned).length;
  return (
    <section className="card col-span-12 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold">Badge case</h2>
          <InfoPopover metricKey="badgeCase" />
        </div>
        <span className="text-[11px] text-muted">
          {earnedCount} of {entry.badges.length} earned
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
        {entry.badges.map((badge) => {
          const meta = BADGE_CATALOG[badge.id];
          return (
            <div
              key={badge.id}
              className={cn(
                'flex flex-col items-center rounded-xl border p-3 text-center transition-colors',
                badge.earned
                  ? 'border-accent/35 bg-accent/[0.07]'
                  : 'border-border bg-bg/40 opacity-70',
              )}
            >
              <span
                className={cn('text-3xl leading-none', !badge.earned && 'opacity-40 grayscale')}
                aria-hidden="true"
              >
                {meta.emoji}
              </span>
              <span className="mt-2 text-[11.5px] font-semibold leading-tight">{meta.name}</span>
              <span className="mt-1 line-clamp-2 text-[10px] leading-snug text-muted" title={meta.rule}>
                {badge.earned ? meta.description : meta.rule}
              </span>
              <span className="mt-2 w-full">
                <span className="block h-1 w-full overflow-hidden rounded-full bg-fg/10">
                  <span
                    className={cn('block h-full rounded-full', badge.earned ? 'bg-good' : 'bg-accent')}
                    style={{ width: `${Math.round(badge.progress * 100)}%` }}
                  />
                </span>
                <span className="mt-1 block text-[9.5px] text-muted">{badge.detail}</span>
              </span>
            </div>
          );
        })}
      </div>
      {entry.scores.trustLowConfidence && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
          <ConfidenceDot reason={`fewer than ${GUARDS.minToolEvents} tool decisions in range`} />
          Acceptance-based numbers are low-confidence for this range.
        </p>
      )}
    </section>
  );
}
