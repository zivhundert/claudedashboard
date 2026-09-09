import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { SlidersHorizontal } from 'lucide-react';
import {
  SEGMENT_CATALOG,
  SEGMENT_ORDER,
  type AdoptionResponse,
  type LeaderboardEntry,
  type ModelDailyCost,
  type OverviewDailyPoint,
  type OverviewResponse,
  type SegmentTier,
} from '@dash/shared';
import { daysBetween, SEGMENT_THRESHOLDS } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import {
  useAdoption,
  useCapabilities,
  useHeatmap,
  useLeaderboard,
  useOverview,
  useSettings,
  useTeams,
} from '@/lib/queries';
import { BreakdownDrawer, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { bucketRange, bucketRows, sumBy } from '@/lib/time';
import {
  fmtBucket,
  fmtCost,
  fmtDateShort,
  fmtHours,
  fmtNumber,
  fmtPct,
  fmtPct100,
  fmtSigned,
  fmtTokens,
} from '@/lib/format';
import { usePrefsStore } from '@/state/prefs';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import { ActivityTrend, aggregateDaily, type ChartRef } from '@/components/TrendChart';
import {
  ActivityCalendar,
  CALENDAR_METRIC_OPTIONS,
  type CalendarMetric,
} from '@/components/ActivityCalendar';
import { WhenWorkCard } from '@/components/WhenWorkCard';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { Field, inputCls, InfoPopover, Segmented } from '@/components/ui';

export default function OrgOverview() {
  const { from, to, gran, teamId } = useRangeParams();
  const q = { from, to, teamId };
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);
  const overviewQ = useOverview({ ...q, gran });
  const leaderboardQ = useLeaderboard(q);
  const heatmapQ = useHeatmap(q);
  const teamsQ = useTeams();
  const settingsQ = useSettings();
  // org-level by design — the endpoint ignores teamId
  const adoptionQ = useAdoption({ from, to });
  const caps = useCapabilities().data?.capabilities;
  // unknown (still loading) counts as available so labels/cards don't flicker
  const seatCounts = caps?.seatCounts !== false;
  const showTerminalMix = caps?.terminalMix !== false;
  const seedRoi = usePrefsStore((s) => s.seedRoi);

  useEffect(() => {
    if (settingsQ.data) seedRoi(settingsQ.data);
  }, [settingsQ.data, seedRoi]);

  const ov = overviewQ.data;
  const partial = useMemo(() => new Set(ov?.partialDates ?? []), [ov]);

  return (
    <ChartPage pageId="org">
      <div className="grid grid-cols-12 gap-4">
        <KpiStrip ov={ov} loading={overviewQ.isLoading} seatCounts={seatCounts} onDrill={setDrill} />

        <ChartCard
          title="Activity trend"
          chartId="activity-trend"
          metricKey="activityTrend"
          subtitle="Sessions (bars) and active users (line)"
          className="col-span-12 lg:col-span-8"
          isLoading={overviewQ.isLoading}
          error={overviewQ.error}
          onRetry={() => void overviewQ.refetch()}
          isEmpty={!!ov && ov.daily.length === 0}
        >
          {(ref) => (
            <ActivityTrend
              instanceRef={ref}
              daily={ov?.daily ?? []}
              gran={gran}
              partial={partial}
              onBucketClick={(bucket) =>
                setDrill({
                  dimension: 'active-users',
                  entity: '',
                  title: `Active · ${fmtBucket(bucket, gran)}`,
                  range: bucketRange(bucket, gran, from, to),
                })
              }
            />
          )}
        </ChartCard>

        <ChartCard
          title="Cache efficiency"
          chartId="cache-gauge"
          metricKey="cacheRatio"
          subtitle="Target band: ≥ 60%"
          className="col-span-12 sm:col-span-6 lg:col-span-4"
          isLoading={overviewQ.isLoading}
          error={overviewQ.error}
          onRetry={() => void overviewQ.refetch()}
          isEmpty={!!ov && ov.kpis.cacheRatio === null}
          emptyText="No token data in this range"
        >
          {(ref) => <CacheGauge instanceRef={ref} ratio={ov?.kpis.cacheRatio ?? 0} />}
        </ChartCard>

        <ChartCard
          title="Code impact"
          chartId="code-impact"
          metricKey="codeImpact"
          subtitle="Lines added ↑ / removed ↓, with net line"
          className="col-span-12 lg:col-span-6"
          isLoading={overviewQ.isLoading}
          error={overviewQ.error}
          onRetry={() => void overviewQ.refetch()}
          isEmpty={!!ov && ov.daily.length === 0}
        >
          {(ref) => <CodeImpact instanceRef={ref} daily={ov?.daily ?? []} gran={gran} partial={partial} />}
        </ChartCard>

        <ChartCard
          title="Cost by model"
          chartId="cost-by-model"
          metricKey="costByModel"
          subtitle="Stacked spend over time"
          className="col-span-12 lg:col-span-6"
          isLoading={overviewQ.isLoading}
          error={overviewQ.error}
          onRetry={() => void overviewQ.refetch()}
          isEmpty={!!ov && ov.modelDailyCost.length === 0}
        >
          {(ref) => <CostByModel instanceRef={ref} rows={ov?.modelDailyCost ?? []} gran={gran} />}
        </ChartCard>

        <ChartCard
          title="Model token mix"
          chartId="model-treemap"
          metricKey="modelMix"
          subtitle="Tokens by model and class; hover for cost share"
          className="col-span-12 lg:col-span-7"
          isLoading={overviewQ.isLoading}
          error={overviewQ.error}
          onRetry={() => void overviewQ.refetch()}
          isEmpty={!!ov && ov.models.length === 0}
        >
          {(ref) => <ModelTreemap instanceRef={ref} ov={ov} />}
        </ChartCard>

        {showTerminalMix && (
          <ChartCard
            title="Terminal mix"
            chartId="terminal-donut"
            metricKey="terminalMix"
            subtitle="Sessions by terminal type"
            className="col-span-12 lg:col-span-5"
            isLoading={overviewQ.isLoading}
            error={overviewQ.error}
            onRetry={() => void overviewQ.refetch()}
            isEmpty={!!ov && ov.terminalMix.length === 0}
          >
            {(ref) => <TerminalDonut instanceRef={ref} ov={ov} />}
          </ChartCard>
        )}

        <WhenWorkCard
          isLoading={heatmapQ.isLoading}
          error={heatmapQ.error}
          onRetry={() => void heatmapQ.refetch()}
          hours={heatmapQ.data?.hours ?? []}
          className="col-span-12 lg:col-span-7"
        />

        <ChartCard
          title="Segment distribution"
          chartId="segment-distribution"
          metricKey="segmentDistribution"
          className="col-span-12 lg:col-span-5"
          isLoading={leaderboardQ.isLoading}
          error={leaderboardQ.error}
          onRetry={() => void leaderboardQ.refetch()}
          isEmpty={!!leaderboardQ.data && leaderboardQ.data.entries.length === 0}
        >
          {(ref) => <SegmentDistribution instanceRef={ref} entries={leaderboardQ.data?.entries ?? []} />}
        </ChartCard>

        <ChartCard
          title="Adoption × Impact"
          chartId="adoption-impact-quadrant"
          metricKey="quadrant"
          subtitle="Each dot is a person — click to open their profile"
          className="col-span-12"
          isLoading={leaderboardQ.isLoading}
          error={leaderboardQ.error}
          onRetry={() => void leaderboardQ.refetch()}
          isEmpty={!!leaderboardQ.data && leaderboardQ.data.entries.length === 0}
        >
          {(ref) => (
            <Quadrant
              instanceRef={ref}
              entries={leaderboardQ.data?.entries ?? []}
              teamColors={new Map((teamsQ.data?.teams ?? []).map((t) => [t.id, t.color]))}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Adoption pulse"
          chartId="adoption-pulse"
          metricKey="wauMau"
          subtitle={`Daily / weekly / monthly actives vs the ${seatCounts ? 'rostered' : 'observed-users'} ceiling (dashed)`}
          className="col-span-12"
          isLoading={adoptionQ.isLoading}
          error={adoptionQ.error}
          onRetry={() => void adoptionQ.refetch()}
          isEmpty={!!adoptionQ.data && adoptionQ.data.series.length === 0}
        >
          {(ref) => <AdoptionPulse instanceRef={ref} adoption={adoptionQ.data} seatCounts={seatCounts} />}
        </ChartCard>

        <OrgCalendarCard
          calendar={adoptionQ.data?.calendar ?? []}
          isLoading={adoptionQ.isLoading}
          error={adoptionQ.error}
          onRetry={() => void adoptionQ.refetch()}
        />

        <RoiCards ov={ov} loading={overviewQ.isLoading} from={from} to={to} />

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

function KpiStrip({
  ov,
  loading,
  seatCounts,
  onDrill,
}: {
  ov: OverviewResponse | undefined;
  loading: boolean;
  /** false = no authoritative roster: the denominator is observed users */
  seatCounts: boolean;
  onDrill: (t: BreakdownTarget) => void;
}) {
  if (loading || !ov) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { kpis, prevKpis, daily } = ov;
  const spark = (f: (d: OverviewDailyPoint) => number) => daily.slice(-30).map(f);
  const netLines = kpis.linesAdded - kpis.linesRemoved;
  const prevNet = prevKpis.linesAdded - prevKpis.linesRemoved;
  const rate = kpis.acceptanceRate;

  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
      <StatCard
        label="Active users"
        value={kpis.activeUsers}
        prev={prevKpis.activeUsers}
        metricKey="activeUsers"
        sparkline={spark((d) => d.activeUsers)}
        footer={
          <span className="flex items-center justify-between gap-2">
            <span>{`${fmtPct100(kpis.adoptionPct)} of ${kpis.rosteredUsers} ${seatCounts ? 'rostered' : 'observed users'}`}</span>
            <button
              type="button"
              onClick={() =>
                onDrill({ dimension: 'active-users', entity: '', title: 'Active users' })
              }
              className="shrink-0 underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
            >
              see who
            </button>
          </span>
        }
      />
      <StatCard
        label="Sessions"
        value={kpis.sessions}
        prev={prevKpis.sessions}
        metricKey="sessions"
        sparkline={spark((d) => d.sessions)}
      />
      <StatCard
        label="Net lines"
        value={netLines}
        prev={prevNet}
        format={fmtSigned}
        metricKey="netLines"
        sparkline={spark((d) => Math.max(0, d.linesAdded - d.linesRemoved))}
        footer={`+${fmtNumber(kpis.linesAdded)} / -${fmtNumber(kpis.linesRemoved)}`}
      />
      <StatCard
        label="Commits + PRs"
        value={kpis.commits + kpis.pullRequests}
        prev={prevKpis.commits + prevKpis.pullRequests}
        metricKey="commitsPrs"
        sparkline={spark((d) => d.commits + d.pullRequests)}
        footer={`${fmtNumber(kpis.commits)} commits · ${fmtNumber(kpis.pullRequests)} PRs`}
      />
      <StatCard
        label="Acceptance rate"
        {...(rate !== null
          ? { value: rate * 100, format: (v: number) => `${v.toFixed(0)}%` }
          : { display: '—' })}
        {...(rate !== null && prevKpis.acceptanceRate !== null
          ? { prev: prevKpis.acceptanceRate * 100 }
          : {})}
        metricKey="acceptanceRate"
        footer="Edit · MultiEdit · Write · Notebook"
      />
      <StatCard
        label="Est. cost"
        value={kpis.costCents}
        prev={prevKpis.costCents}
        format={fmtCost}
        invertDelta
        metricKey="estCost"
        sparkline={spark((d) => d.costCents)}
        footer={`${fmtTokens(kpis.tokens.input + kpis.tokens.output + kpis.tokens.cacheRead + kpis.tokens.cacheCreation)} tokens`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

type Ref = ChartRef;

function CodeImpact({
  instanceRef,
  daily,
  gran,
  partial,
}: {
  instanceRef: Ref;
  daily: OverviewDailyPoint[];
  gran: 'day' | 'week' | 'month';
  partial: Set<string>;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const agg = aggregateDaily(daily, gran, partial);
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const items = asTipArray(raw);
          const head = items[0]?.name ?? '';
          const lines = items.map((p) => {
            const v = typeof p.value === 'number' ? p.value : 0;
            return `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtNumber(Math.abs(v))}</b>`;
          });
          return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: agg.map((a) => fmtBucket(a.bucket, gran)),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: [
        {
          name: 'Lines added',
          type: 'bar',
          stack: 'code',
          barMaxWidth: 26,
          data: agg.map((a) => ({
            value: a.linesAdded,
            itemStyle: { color: t.good, opacity: a.isPartial ? 0.4 : 0.85, borderRadius: [3, 3, 0, 0] },
          })),
        },
        {
          name: 'Lines removed',
          type: 'bar',
          stack: 'code',
          barMaxWidth: 26,
          data: agg.map((a) => ({
            value: -a.linesRemoved,
            itemStyle: { color: t.risk, opacity: a.isPartial ? 0.4 : 0.75, borderRadius: [0, 0, 3, 3] },
          })),
        },
        {
          name: 'Net',
          type: 'line',
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.accent2, width: 2 },
          itemStyle: { color: t.accent2 },
          data: agg.map((a) => ({
            value: a.linesAdded - a.linesRemoved,
            ...(a.isPartial
              ? { symbol: 'emptyCircle', itemStyle: { color: t.card, borderColor: t.accent2, borderWidth: 2 } }
              : {}),
          })),
        },
      ],
    };
  }, [daily, gran, partial, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function CostByModel({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: Ref;
  rows: ModelDailyCost[];
  gran: 'day' | 'week' | 'month';
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const models = [...new Set(rows.map((r) => r.model))].sort();
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const items = asTipArray(raw);
          const head = items[0]?.name ?? '';
          const lines = items
            .filter((p) => typeof p.value === 'number' && p.value > 0)
            .map((p) => `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtCost(p.value as number)}</b>`);
          const total = items.reduce((acc, p) => acc + (typeof p.value === 'number' ? p.value : 0), 0);
          return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}<div style="margin-top:2px;border-top:1px solid ${t.border};padding-top:2px">Total: <b>${fmtCost(total)}</b></div>`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8, type: 'scroll' },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtCost(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: models.map((m) => ({
        name: m,
        type: 'line' as const,
        stack: 'cost',
        smooth: true,
        symbol: 'none',
        areaStyle: { opacity: 0.35 },
        lineStyle: { width: 1.5 },
        emphasis: { focus: 'series' as const },
        data: buckets.map((b) => sumBy(b.rows.filter((r) => r.model === m), (r) => r.costCents)),
      })),
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function ModelTreemap({ instanceRef, ov }: { instanceRef: Ref; ov: OverviewResponse | undefined }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const models = ov?.models ?? [];
    const totalCost = sumBy(models, (m) => m.costCents) || 1;
    const costByModel = new Map(models.map((m) => [m.model, m.costCents]));
    const data = models.map((m, i) => {
      const color = t.palette[i % t.palette.length] ?? t.accent;
      const classes = [
        { name: 'Input', value: m.tokens.input },
        { name: 'Output', value: m.tokens.output },
        { name: 'Cache read', value: m.tokens.cacheRead },
        { name: 'Cache write', value: m.tokens.cacheCreation },
      ].filter((c) => c.value > 0);
      return {
        name: m.model,
        value: classes.reduce((a, c) => a + c.value, 0),
        itemStyle: { color, borderColor: t.card },
        children: classes.map((c, j) => ({
          name: c.name,
          value: c.value,
          itemStyle: { color, colorAlpha: 1 - j * 0.18, borderColor: t.card },
        })),
      };
    });
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          const path = (p as { treePathInfo?: Array<{ name: string }> }).treePathInfo ?? [];
          const modelName = path[1]?.name ?? p.name ?? '';
          const cost = costByModel.get(modelName) ?? 0;
          const value = typeof p.value === 'number' ? p.value : 0;
          return `<b>${path.map((x) => x.name).filter(Boolean).join(' › ') || p.name}</b><br/>${fmtTokens(value)} tokens<br/>${modelName ? `Model cost: ${fmtCost(cost)} (${fmtPct(cost / totalCost)} of spend)` : ''}`;
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: '100%',
          height: '100%',
          label: { color: '#fff', fontSize: 11, formatter: '{b}' },
          upperLabel: { show: true, height: 20, color: '#fff', fontSize: 11, fontWeight: 'bold' },
          itemStyle: { borderColor: t.card, borderWidth: 1, gapWidth: 1 },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 2 } },
            { itemStyle: { gapWidth: 1, borderWidth: 2 } },
          ],
          data,
        },
      ],
    };
  }, [ov, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function TerminalDonut({ instanceRef, ov }: { instanceRef: Ref; ov: OverviewResponse | undefined }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const mix = ov?.terminalMix ?? [];
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}${p.name ?? ''}: <b>${fmtNumber(typeof p.value === 'number' ? p.value : 0)}</b> sessions (${p.percent ?? 0}%)`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'middle',
        textStyle: { color: t.muted, fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
      },
      series: [
        {
          type: 'pie',
          radius: ['55%', '80%'],
          center: ['38%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data: mix.map((m) => ({ name: m.terminalType || 'unknown', value: m.sessions })),
        },
      ],
    };
  }, [ov, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function CacheGauge({ instanceRef, ratio }: { instanceRef: Ref; ratio: number }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const pct = Math.round(ratio * 100);
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '95%',
          center: ['50%', '60%'],
          axisLine: {
            lineStyle: {
              width: 14,
              color: [
                [0.6, t.isDark ? '#3a4152' : '#e2e8f0'],
                [1, `${t.good}55`],
              ],
            },
          },
          progress: { show: true, width: 14, itemStyle: { color: pct >= 60 ? t.good : t.warn } },
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          anchor: { show: false },
          title: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, 0],
            fontSize: 34,
            fontWeight: 'bold',
            color: pct >= 60 ? t.good : t.warn,
            formatter: '{value}%',
          },
          data: [{ value: pct }],
        },
      ],
      graphic: [
        {
          type: 'text',
          left: 'center',
          bottom: 8,
          style: {
            text: pct >= 60 ? 'Healthy — cache is doing its job' : 'Below target — context is being re-billed',
            fill: t.muted,
            fontSize: 11,
          },
        },
      ],
    };
  }, [ratio, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Adoption pulse + org calendar
// ---------------------------------------------------------------------------

function AdoptionPulse({
  instanceRef,
  adoption,
  seatCounts,
}: {
  instanceRef: Ref;
  adoption: AdoptionResponse | undefined;
  seatCounts: boolean;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const series = adoption?.series ?? [];
    const rostered = adoption?.rosteredUsers ?? 0;
    const maxMau = series.reduce((m, s) => Math.max(m, s.mau), 0);
    const ceiling = Math.max(rostered, maxMau);
    const line = (
      name: string,
      color: string,
      pick: (s: { dau: number; wau: number; mau: number }) => number,
    ) => ({
      name,
      type: 'line' as const,
      smooth: true,
      symbol: 'none' as const,
      lineStyle: { color, width: 2 },
      itemStyle: { color },
      emphasis: { focus: 'series' as const },
      data: series.map(pick),
    });
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 48, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: series.map((s) => fmtDateShort(s.date)),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: {
        type: 'value',
        name: 'users',
        nameTextStyle: { color: t.muted, fontSize: 10 },
        ...(ceiling > 0 ? { max: Math.ceil(ceiling * 1.08) } : {}),
        axisLabel: { color: t.muted, fontSize: 10.5 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: [
        {
          ...line('DAU', t.accent, (s) => s.dau),
          ...(rostered > 0
            ? {
                markLine: {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: t.muted, type: 'dashed' as const, width: 1 },
                  label: {
                    formatter: `${seatCounts ? 'roster' : 'observed'} ${rostered}`,
                    color: t.muted,
                    fontSize: 10,
                    position: 'end' as const,
                  },
                  data: [{ yAxis: rostered }],
                },
              }
            : {}),
        },
        line('WAU', t.accent2, (s) => s.wau),
        line('MAU', t.palette[2] ?? t.good, (s) => s.mau),
      ],
    };
  }, [adoption, seatCounts, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

function OrgCalendarCard({
  calendar,
  isLoading,
  error,
  onRetry,
}: {
  calendar: AdoptionResponse['calendar'];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [metric, setMetric] = useState<CalendarMetric>('sessions');
  return (
    <ChartCard
      title="Org activity calendar"
      chartId="org-activity-calendar"
      metricKey="activityCalendar"
      infoExtra="Org-wide activity for the trailing 12 months, independent of the selected range."
      actions={
        <Segmented size="xs" options={CALENDAR_METRIC_OPTIONS} value={metric} onChange={setMetric} />
      }
      className="col-span-12"
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={calendar.length === 0}
      emptyText="No activity in the last 12 months"
    >
      {(ref) => <ActivityCalendar instanceRef={ref} data={calendar} metric={metric} />}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Quadrant + segments
// ---------------------------------------------------------------------------

function Quadrant({
  instanceRef,
  entries,
  teamColors,
}: {
  instanceRef: Ref;
  entries: LeaderboardEntry[];
  teamColors: Map<number, string>;
}) {
  const t = useChartTheme();
  const navigate = useNavigate();
  const option = useMemo<EChartsOption>(() => {
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0];
          const d = (p?.data ?? {}) as {
            name?: string;
            teamName?: string;
            segment?: SegmentTier;
            composite?: number | null;
            sessions?: number;
            netLines?: number;
            value?: [number, number];
          };
          const seg = d.segment ? SEGMENT_CATALOG[d.segment] : null;
          return [
            `<b>${d.name ?? ''}</b>${d.teamName ? ` · ${d.teamName}` : ''}`,
            seg ? `${seg.emoji} ${seg.name} · composite ${d.composite ?? '—'}` : '',
            `Adoption <b>${d.value?.[0] ?? 0}</b> · Impact <b>${d.value?.[1] ?? 0}</b>`,
            `${fmtNumber(d.sessions ?? 0)} sessions · ${fmtSigned(d.netLines ?? 0)} lines`,
            `<span style="color:${t.muted};font-size:10px">Click to open profile</span>`,
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
      xAxis: {
        type: 'value',
        name: 'Adoption',
        nameLocation: 'middle',
        nameGap: 24,
        nameTextStyle: { color: t.muted, fontSize: 11 },
        min: 0,
        max: 100,
        axisLabel: { color: t.muted, fontSize: 10.5 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      yAxis: {
        type: 'value',
        name: 'Impact',
        nameTextStyle: { color: t.muted, fontSize: 11 },
        min: 0,
        max: 100,
        axisLabel: { color: t.muted, fontSize: 10.5 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: (val: unknown, params: unknown) => {
            const d = (params as { data?: { sessions?: number } }).data;
            return Math.min(26, 8 + Math.sqrt(d?.sessions ?? 0));
          },
          itemStyle: { opacity: 0.85, borderColor: t.card, borderWidth: 1 },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: t.border, type: 'dashed', width: 1 },
            data: [
              { xAxis: SEGMENT_THRESHOLDS.starterBelowAdoption },
              { xAxis: SEGMENT_THRESHOLDS.producer.adoption },
              { xAxis: SEGMENT_THRESHOLDS.champion.adoption },
              { yAxis: SEGMENT_THRESHOLDS.producer.impact },
              { yAxis: SEGMENT_THRESHOLDS.champion.impact },
            ],
          },
          data: entries.map((e) => ({
            name: e.user.name,
            value: [e.scores.adoption, e.scores.impact] as [number, number],
            email: e.user.email,
            userId: e.user.id,
            teamName: e.user.teamName,
            segment: e.segment,
            composite: e.scores.composite,
            sessions: e.metrics.sessions,
            netLines: e.metrics.linesAdded - e.metrics.linesRemoved,
            itemStyle: {
              color:
                (e.user.teamId != null ? teamColors.get(e.user.teamId) : undefined) ??
                t.tier[e.segment],
            },
          })),
        },
      ],
    };
  }, [entries, teamColors, t]);

  return (
    <EChart
      option={option}
      instanceRef={instanceRef}
      className="h-96"
      onClickPoint={(params) => {
        const d = params.data as { email?: string | null; userId?: number } | undefined;
        if (d && (d.email || d.userId !== undefined)) {
          navigate(`/user/${encodeURIComponent(d.email ?? String(d.userId))}`);
        }
      }}
    />
  );
}

function SegmentDistribution({ instanceRef, entries }: { instanceRef: Ref; entries: LeaderboardEntry[] }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const counts = new Map<SegmentTier, number>();
    for (const e of entries) counts.set(e.segment, (counts.get(e.segment) ?? 0) + 1);
    const order = [...SEGMENT_ORDER].reverse(); // starter → champion left-to-right
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
      },
      legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5 },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      yAxis: { type: 'category', data: ['People'], axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false } },
      series: order.map((tier) => {
        const meta = SEGMENT_CATALOG[tier];
        return {
          name: `${meta.emoji} ${meta.name}`,
          type: 'bar' as const,
          stack: 'seg',
          barMaxWidth: 44,
          label: {
            show: (counts.get(tier) ?? 0) > 0,
            color: '#fff',
            fontSize: 11,
            formatter: '{c}',
          },
          itemStyle: { color: t.tier[tier] },
          data: [counts.get(tier) ?? 0],
        };
      }),
    };
  }, [entries, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// ROI cards
// ---------------------------------------------------------------------------

function RoiCards({
  ov,
  loading,
  from,
  to,
}: {
  ov: OverviewResponse | undefined;
  loading: boolean;
  from: string;
  to: string;
}) {
  const roi = usePrefsStore((s) => s.roi);
  const setRoi = usePrefsStore((s) => s.setRoi);

  if (loading || !ov) {
    return (
      <div className="col-span-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }

  const netLines = Math.max(0, ov.kpis.linesAdded - ov.kpis.linesRemoved);
  const hoursSaved = netLines / (roi.linesPerMinute * 60);
  const savings = hoursSaved * roi.hourlyRateUsd;
  const rangeDays = daysBetween(from, to) + 1;
  const seatSpend = ov.kpis.rosteredUsers * roi.seatCostUsdMonthly * (rangeDays / 30);
  const apiSpend = ov.kpis.costCents / 100;
  const spend = seatSpend + apiSpend;
  const roiPct = spend > 0 ? ((savings - spend) / spend) * 100 : null;

  const assumptions = (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-fg"
        >
          <SlidersHorizontal size={10} /> Assumptions
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={6}
          className="card pop-in z-50 w-64 space-y-2.5 p-3 shadow-xl"
        >
          <div className="text-xs font-semibold">Business-value assumptions</div>
          <Field label="Lines per engineer-minute">
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={roi.linesPerMinute}
              onChange={(e) => setRoi({ linesPerMinute: Number(e.target.value) || 1 })}
              className={inputCls}
            />
          </Field>
          <Field label="Hourly rate (USD)">
            <input
              type="number"
              min={1}
              value={roi.hourlyRateUsd}
              onChange={(e) => setRoi({ hourlyRateUsd: Number(e.target.value) || 1 })}
              className={inputCls}
            />
          </Field>
          <Field label="Seat cost (USD / month)">
            <input
              type="number"
              min={0}
              value={roi.seatCostUsdMonthly}
              onChange={(e) => setRoi({ seatCostUsdMonthly: Number(e.target.value) || 0 })}
              className={inputCls}
            />
          </Field>
          <p className="text-[10.5px] leading-relaxed text-muted">
            Stored locally in your browser; defaults come from Admin → Settings. Seat spend is
            prorated to the selected range ({rangeDays}d).
          </p>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );

  return (
    <div className="col-span-12">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          Business value <InfoPopover metricKey="roi" />
        </div>
        {assumptions}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          label="Time saved"
          value={hoursSaved}
          format={fmtHours}
          metricKey="timeSaved"
          hero
          footer={`${fmtNumber(netLines)} net lines ÷ ${roi.linesPerMinute} lines/min`}
        />
        <StatCard
          label="Cost savings"
          value={savings * 100}
          format={fmtCost}
          metricKey="costSavings"
          hero
          footer={`${fmtHours(hoursSaved)} × $${roi.hourlyRateUsd}/hr`}
        />
        <StatCard
          label="ROI"
          {...(roiPct !== null
            ? { value: roiPct, format: (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v)}%` }
            : { display: '—' })}
          metricKey="roi"
          hero
          footer={`vs ${fmtCost(Math.round(spend * 100))} spend (seats ${fmtCost(Math.round(seatSpend * 100))} + API ${fmtCost(ov.kpis.costCents)})`}
        />
      </div>
    </div>
  );
}
