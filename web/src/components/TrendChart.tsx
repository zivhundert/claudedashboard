import { useMemo } from 'react';
import type { Granularity, OverviewDailyPoint } from '@dash/shared';
import { EChart, type EChartsOption, type EChartsInstance } from '@/components/EChart';
import { useChartTheme, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { bucketKey } from '@/lib/time';
import { fmtBucket } from '@/lib/format';

export type ChartRef = React.MutableRefObject<EChartsInstance | null>;

export interface AggPoint {
  bucket: string;
  sessions: number;
  activeUsers: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  costCents: number;
  isPartial: boolean;
}

/**
 * The server buckets `/api/overview` points by `gran` (bucket-start dates,
 * Sunday weeks) with correct distinct activeUsers per bucket — use points
 * as-is; no client-side re-aggregation. `bucketKey` only normalizes the
 * bucket label (e.g. '2026-07-01' → '2026-07' for months).
 */
export function aggregateDaily(
  daily: OverviewDailyPoint[],
  gran: Granularity,
  partial: Set<string>,
): AggPoint[] {
  return [...daily]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({
      bucket: bucketKey(d.date, gran),
      sessions: d.sessions,
      activeUsers: d.activeUsers,
      linesAdded: d.linesAdded,
      linesRemoved: d.linesRemoved,
      commits: d.commits,
      pullRequests: d.pullRequests,
      costCents: d.costCents,
      isPartial: partial.has(d.date),
    }));
}

/** Bars (sessions) + line (active users) on dual axes; partial buckets hollow/faded. */
export function ActivityTrend({
  instanceRef,
  daily,
  gran,
  partial,
  height = 'h-72',
}: {
  instanceRef: ChartRef;
  daily: OverviewDailyPoint[];
  gran: Granularity;
  partial: Set<string>;
  height?: string;
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
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 8, top: NAMED_AXIS_GRID_TOP, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: agg.map((a) => fmtBucket(a.bucket, gran)),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10.5 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'sessions',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'users',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Sessions',
          type: 'bar',
          barMaxWidth: 26,
          data: agg.map((a) => ({
            value: a.sessions,
            itemStyle: {
              color: t.accent,
              opacity: a.isPartial ? 0.4 : 0.9,
              borderRadius: [3, 3, 0, 0],
              ...(a.isPartial ? { borderColor: t.accent, borderWidth: 1, borderType: 'dashed' as const } : {}),
            },
          })),
        },
        {
          name: 'Active users',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 6,
          lineStyle: { color: t.accent2, width: 2 },
          itemStyle: { color: t.accent2 },
          data: agg.map((a) => ({
            value: a.activeUsers,
            ...(a.isPartial
              ? { symbol: 'emptyCircle', itemStyle: { color: t.card, borderColor: t.accent2, borderWidth: 2 } }
              : {}),
          })),
        },
      ],
    };
  }, [daily, gran, partial, t]);
  return <EChart option={option} instanceRef={instanceRef} className={height} />;
}
