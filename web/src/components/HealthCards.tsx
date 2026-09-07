/**
 * Reliability + governance cards shared by the org Health page and the
 * Personal page (scoped to one user there — no per-user drill-downs).
 */
import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { DecisionSource, GovernanceResponse, Granularity, ReliabilityResponse } from '@dash/shared';
import { useChartTheme, asTipArray, type ChartTheme, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtNumber, fmtPct } from '@/lib/format';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

/** amber above 2%, red above 5% — rate is a 0..1 ratio */
export function errorRateClass(rate: number | null): string {
  if (rate === null) return 'text-muted';
  if (rate > 0.05) return 'text-risk';
  if (rate > 0.02) return 'text-warn';
  return 'text-good';
}

export function fmtMs(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return '—';
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms).toLocaleString('en-US')} ms`;
}

// ---------------------------------------------------------------------------
// Reliability KPIs
// ---------------------------------------------------------------------------

export function ReliabilityKpis({
  rel,
  loading,
  noData,
  noDataText = 'Waiting for telemetry',
}: {
  rel: ReliabilityResponse | undefined;
  loading: boolean;
  noData: boolean;
  noDataText?: string;
}) {
  if (loading || !rel) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { totals } = rel;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="API requests"
        {...(noData ? { display: '—' } : { value: totals.apiRequests })}
        metricKey="errorRate"
        footer={noData ? noDataText : `${fmtNumber(totals.apiErrors)} failed`}
      />
      <StatCard
        label="Error rate"
        {...(noData || totals.errorRate === null
          ? { display: '—' }
          : { value: totals.errorRate * 100, format: (v: number) => `${v.toFixed(1)}%` })}
        valueClassName={noData ? undefined : errorRateClass(totals.errorRate)}
        metricKey="errorRate"
        footer={noData ? noDataText : 'amber above 2% · red above 5%'}
      />
      <StatCard
        label="Refusals"
        {...(noData ? { display: '—' } : { value: totals.refusals })}
        metricKey="refusals"
        footer={noData ? noDataText : 'requests Claude declined'}
      />
      <StatCard
        label="Avg latency"
        {...(noData || totals.avgRequestMs === null
          ? { display: '—' }
          : { value: totals.avgRequestMs, format: (v: number) => fmtMs(v) })}
        metricKey="errorRate"
        footer={noData ? noDataText : 'mean API request duration'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error trend
// ---------------------------------------------------------------------------

export function ErrorTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: ReliabilityResponse['daily'];
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
          name: 'requests',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'errors',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          minInterval: 1,
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'API requests',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent, opacity: 0.85, borderRadius: [3, 3, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.apiRequests)),
        },
        {
          name: 'Errors',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.risk, width: 2 },
          itemStyle: { color: t.risk },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.apiErrors)),
        },
        {
          name: 'Refusals',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 4,
          lineStyle: { color: t.warn, width: 1.5, type: 'dashed' },
          itemStyle: { color: t.warn },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.refusals)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}

// ---------------------------------------------------------------------------
// Error status donut
// ---------------------------------------------------------------------------

export function ErrorStatusDonut({
  instanceRef,
  rel,
}: {
  instanceRef: ChartRef;
  rel: ReliabilityResponse | undefined;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const st = rel?.errorStatuses ?? { e429: 0, e5xx: 0, other: 0 };
    const data = [
      { name: '429 rate limited', value: st.e429, itemStyle: { color: t.warn } },
      { name: '5xx server', value: st.e5xx, itemStyle: { color: t.risk } },
      { name: 'Other', value: st.other, itemStyle: { color: t.muted } },
    ].filter((d) => d.value > 0);
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b>: ${fmtNumber(typeof p.value === 'number' ? p.value : 0)} (${p.percent ?? 0}%)`;
        },
      },
      legend: {
        orient: 'vertical',
        right: 0,
        top: 'middle',
        textStyle: { color: t.muted, fontSize: 10.5 },
        icon: 'circle',
        itemWidth: 8,
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['32%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data,
        },
      ],
    };
  }, [rel, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-48" />;
}

// ---------------------------------------------------------------------------
// By-model table
// ---------------------------------------------------------------------------

export function ByModelTable({
  rows,
  onDrill,
}: {
  rows: ReliabilityResponse['byModel'];
  /** omit on a single person's page — model names are then plain text */
  onDrill?: ((t: BreakdownTarget) => void) | undefined;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.apiRequests - a.apiRequests), [rows]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Model', 'Requests', 'Error rate', 'Refusals', 'Avg latency'].map((h, i) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i > 0 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.model} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="max-w-64 truncate px-2.5 py-2 text-[12.5px] font-medium" title={m.model}>
                {onDrill ? (
                  <button
                    type="button"
                    onClick={() =>
                      onDrill({
                        dimension: 'model-reliability',
                        entity: m.model,
                        title: `Reliability · ${m.model}`,
                      })
                    }
                    title={`${m.model} — see who hits errors`}
                    className="truncate underline decoration-dotted underline-offset-2 transition-colors hover:text-accent"
                  >
                    {m.model}
                  </button>
                ) : (
                  <span className="truncate">{m.model}</span>
                )}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-[12.5px]">
                {fmtNumber(m.apiRequests)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-right text-xs font-medium',
                  errorRateClass(m.errorRate),
                )}
              >
                {fmtPct(m.errorRate, 1)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(m.refusals)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtMs(m.avgRequestMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Governance: decision sources stacked bar
// ---------------------------------------------------------------------------

const DECISION_META: Array<{ key: DecisionSource; label: string; color: (t: ChartTheme) => string }> = [
  { key: 'config', label: 'Config allowlist', color: (t) => t.good },
  { key: 'hook', label: 'Hook', color: (t) => t.palette[2] ?? t.accent2 },
  { key: 'user_permanent', label: 'Always allow', color: (t) => t.accent },
  { key: 'user_temporary', label: 'One-off allow', color: (t) => t.accent2 },
  { key: 'user_abort', label: 'Aborted', color: (t) => t.warn },
  { key: 'user_reject', label: 'Rejected', color: (t) => t.risk },
];

export function DecisionSourcesStacked({
  instanceRef,
  gov,
}: {
  instanceRef: ChartRef;
  gov: GovernanceResponse | undefined;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const sources = gov?.decisionSources;
    const total = DECISION_META.reduce((acc, m) => acc + (sources?.[m.key] ?? 0), 0) || 1;
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          const v = typeof p.value === 'number' ? p.value : 0;
          return `${p.marker ?? ''}<b>${p.seriesName ?? ''}</b>: ${fmtNumber(v)} (${fmtPct(v / total)})`;
        },
      },
      legend: { bottom: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 16, top: 16, bottom: 44, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      yAxis: {
        type: 'category',
        data: ['Decisions'],
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      series: DECISION_META.map((m) => {
        const value = sources?.[m.key] ?? 0;
        const pct = value / total;
        return {
          name: m.label,
          type: 'bar' as const,
          stack: 'sources',
          barMaxWidth: 46,
          itemStyle: { color: m.color(t) },
          label: {
            show: pct >= 0.05,
            color: '#fff',
            fontSize: 10.5,
            formatter: () => fmtPct(pct),
          },
          data: [value],
        };
      }),
    };
  }, [gov, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-44" />;
}

// ---------------------------------------------------------------------------
// Permission modes table
// ---------------------------------------------------------------------------

/** Modes that skip or weaken the permission prompt deserve a visible flag. */
const isBypassy = (mode: string) =>
  /bypass|dontask|dont_ask|yolo|dangerous/i.test(mode) || mode === 'acceptEdits';

export function PermissionModesTable({
  rows,
  onDrill,
}: {
  rows: GovernanceResponse['permissionModes'];
  /** omit on a single person's page — the Users column is then hidden */
  onDrill?: ((t: BreakdownTarget) => void) | undefined;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.changes - a.changes), [rows]);
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          {['Mode', 'Changes', ...(onDrill ? ['Users'] : [])].map((h, i) => (
            <th
              key={h}
              className={cn(
                'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                i > 0 && 'text-right',
              )}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.map((m) => (
          <tr key={m.mode} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
            <td className="px-2.5 py-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[12px]">{m.mode}</span>
                {isBypassy(m.mode) && (
                  <Tip content="This mode skips or weakens permission prompts — worth knowing who uses it.">
                    <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide text-warn">
                      <ShieldAlert size={9} /> bypass
                    </span>
                  </Tip>
                )}
              </span>
            </td>
            <td className="whitespace-nowrap px-2.5 py-2 text-right text-[12.5px] font-medium">
              {fmtNumber(m.changes)}
            </td>
            {onDrill && (
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                <DrillCount
                  value={m.users}
                  onClick={() =>
                    onDrill({
                      dimension: 'permission-mode',
                      entity: m.mode,
                      title: `Permission mode · ${m.mode}`,
                    })
                  }
                />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
