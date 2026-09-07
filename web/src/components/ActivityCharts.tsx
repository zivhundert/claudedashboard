import { useMemo } from 'react';
import type { ActivityResponse, Granularity } from '@dash/shared';
import { useChartTheme, asTipArray, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtDurationMs, fmtDurationSec, fmtNumber } from '@/lib/format';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { ChartCard } from '@/components/ChartCard';

// ---------------------------------------------------------------------------
// KPI row — engaged time / Claude working / prompts / sessions
// ---------------------------------------------------------------------------

/** Median of the positive values, null when none. */
function median(values: number[]): number | null {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? (v[mid] ?? null) : ((v[mid - 1] ?? 0) + (v[mid] ?? 0)) / 2;
}

/** Org medians per person for the KPI footers — from an org-wide activity response. */
export function orgMediansOf(org: ActivityResponse | undefined): ActivityMedians | undefined {
  if (!org || org.perUser.length === 0) return undefined;
  return {
    activeUserSeconds: median(org.perUser.map((u) => u.activeUserSeconds)),
    prompts: median(org.perUser.map((u) => u.prompts)),
    sessions: median(org.perUser.map((u) => u.sessions)),
  };
}

export interface ActivityMedians {
  activeUserSeconds: number | null;
  prompts: number | null;
  sessions: number | null;
}

export function ActivityKpis({
  activity,
  loading,
  noData,
  noDataText = 'Waiting for telemetry',
  prev,
  orgMedian,
}: {
  activity: ActivityResponse | undefined;
  loading: boolean;
  noData: boolean;
  noDataText?: string;
  /** same totals for the previous period → delta chips */
  prev?: ActivityResponse['totals'] | undefined;
  /** org medians per person → "org median …" footers (Personal page) */
  orgMedian?: ActivityMedians | undefined;
}) {
  if (loading || !activity) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { totals } = activity;
  const promptsPerSession = totals.sessions > 0 ? (totals.prompts / totals.sessions).toFixed(1) : null;
  const med = (v: number | null | undefined, fmt: (n: number) => string) =>
    v === null || v === undefined ? null : `org median ${fmt(v)}`;
  const withMedian = (base: string, m: string | null) => (m ? `${base} · ${m}` : base);
  const p = noData ? undefined : prev;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Engaged time"
        {...(noData ? { display: '—' } : { value: totals.activeUserSeconds, format: fmtDurationSec })}
        {...(p ? { prev: p.activeUserSeconds } : {})}
        metricKey="activeTime"
        footer={noData ? noDataText : withMedian('developer hands-on time', med(orgMedian?.activeUserSeconds, fmtDurationSec))}
      />
      <StatCard
        label="Claude working"
        {...(noData ? { display: '—' } : { value: totals.activeCliSeconds, format: fmtDurationSec })}
        {...(p ? { prev: p.activeCliSeconds } : {})}
        metricKey="activeTime"
        footer={noData ? noDataText : 'CLI actively working'}
      />
      <StatCard
        label="Prompts"
        {...(noData ? { display: '—' } : { value: totals.prompts })}
        {...(p ? { prev: p.prompts } : {})}
        metricKey="promptCadence"
        footer={
          noData
            ? noDataText
            : withMedian(
                promptsPerSession ? `${promptsPerSession} per session` : 'content is never collected',
                med(orgMedian?.prompts, fmtNumber),
              )
        }
      />
      <StatCard
        label="Sessions"
        {...(noData ? { display: '—' } : { value: totals.sessions })}
        {...(p ? { prev: p.sessions } : {})}
        metricKey="sessionLength"
        footer={
          noData
            ? noDataText
            : withMedian(
                `avg ${fmtDurationMs(totals.avgSessionMs)} · median ${fmtDurationMs(totals.medianSessionMs)} (span incl. idle)`,
                med(orgMedian?.sessions, fmtNumber),
              )
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engaged time trend (stacked area, developer vs CLI)
// ---------------------------------------------------------------------------

export function EngagedTimeTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: ActivityResponse['daily'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    const toHours = (sec: number) => sec / 3600;
    const series = [
      { name: 'Developer', color: t.accent, pick: (r: ActivityResponse['daily'][number]) => r.activeUserSeconds },
      { name: 'Claude (CLI)', color: t.accent2, pick: (r: ActivityResponse['daily'][number]) => r.activeCliSeconds },
    ];
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
          const lines = items.map(
            (p) =>
              `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtDurationSec(
                (typeof p.value === 'number' ? p.value : 0) * 3600,
              )}</b>`,
          );
          return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: NAMED_AXIS_GRID_TOP, bottom: 4, containLabel: true },
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
        name: 'hours',
        nameGap: NAMED_AXIS_NAME_GAP,
        nameTextStyle: { color: t.muted, fontSize: 10 },
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => `${fmtNumber(v)}h` },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: series.map((s) => ({
        name: s.name,
        type: 'line' as const,
        stack: 'engaged',
        smooth: true,
        // a one-bucket range (the Today preset) has no line to draw — show the point
        symbol: buckets.length === 1 ? ('circle' as const) : ('none' as const),
        symbolSize: 7,
        lineStyle: { color: s.color, width: 1.5 },
        itemStyle: { color: s.color },
        areaStyle: { color: s.color, opacity: 0.3 },
        emphasis: { focus: 'series' as const },
        data: buckets.map((b) => Number(toHours(sumBy(b.rows, s.pick)).toFixed(2))),
      })),
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Prompts (bars) + sessions (line)
// ---------------------------------------------------------------------------

export function PromptsSessionsTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: ActivityResponse['daily'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: NAMED_AXIS_GRID_TOP, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'prompts',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'sessions',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Prompts',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent, opacity: 0.9, borderRadius: [3, 3, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.prompts)),
        },
        {
          name: 'Sessions',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.accent2, width: 2 },
          itemStyle: { color: t.accent2 },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.sessions)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Session length card
// ---------------------------------------------------------------------------

export function SessionLengthCard({
  activity,
  isLoading,
  noData,
  chartId = 'session-length',
  className = 'col-span-12 lg:col-span-4',
  noDataText = 'Waiting for telemetry events',
}: {
  activity: ActivityResponse | undefined;
  isLoading: boolean;
  noData: boolean;
  chartId?: string;
  className?: string;
  noDataText?: string;
}) {
  const totals = activity?.totals;
  const engagedShare =
    totals && totals.avgSessionMs && totals.avgSessionMs > 0 && totals.sessions > 0
      ? Math.min(1, (totals.activeUserSeconds * 1000) / (totals.avgSessionMs * totals.sessions))
      : null;
  return (
    <ChartCard
      title="Session length"
      chartId={chartId}
      metricKey="sessionLength"
      subtitle="Wall-clock span incl. idle — compare with Engaged time"
      className={className}
      noExport
      isLoading={isLoading}
      isEmpty={noData || !totals || totals.avgSessionMs === null}
      emptyText={noData ? noDataText : 'No sessions tracked in this range'}
    >
      <div className="flex h-full flex-col justify-center gap-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-fg/[0.03] p-3.5 text-center">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Average</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              {fmtDurationMs(totals?.avgSessionMs)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-fg/[0.03] p-3.5 text-center">
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Median</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              {fmtDurationMs(totals?.medianSessionMs)}
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-warn/25 bg-warn/[0.07] px-2.5 py-1.5 text-[11px] leading-relaxed text-muted">
          <span className="font-medium text-warn">Span incl. idle</span> — a session left open over
          lunch counts.{' '}
          {engagedShare !== null &&
            `Roughly ${Math.round(engagedShare * 100)}% of the average span is genuinely engaged time.`}
        </div>
      </div>
    </ChartCard>
  );
}
