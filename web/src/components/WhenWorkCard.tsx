import { useMemo, useState } from 'react';
import { weekdayOrder, type HeatmapHour } from '@dash/shared';
import { ChartCard } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { binHeatmap, displayWeekStart, displayWorkweek, WEEKDAY_LABELS } from '@/lib/time';
import { fmtPct, fmtTokens } from '@/lib/format';
import { Segmented } from '@/components/ui';

/**
 * 7×24 activity heatmap in the org zone, rows from WEEK_START, days outside
 * WORKWEEK dimmed; absolute / row-normalized toggle.
 */
export function WhenWorkCard({
  hours,
  isLoading,
  error,
  onRetry,
  className,
  title = 'When we work',
  chartId = 'when-we-work',
}: {
  hours: HeatmapHour[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  className?: string;
  title?: string;
  chartId?: string;
}) {
  const [mode, setMode] = useState<'abs' | 'norm'>('abs');
  const bins = useMemo(() => binHeatmap(hours), [hours]);
  const peakLabel = bins.peak
    ? `Peak: ${WEEKDAY_LABELS[bins.peak.weekday] ?? ''} ${String(bins.peak.hour).padStart(2, '0')}:00`
    : undefined;

  return (
    <ChartCard
      title={title}
      chartId={chartId}
      metricKey="whenWeWork"
      {...(peakLabel ? { subtitle: peakLabel } : {})}
      actions={
        <Segmented
          size="xs"
          options={[
            { id: 'abs' as const, label: 'Absolute' },
            { id: 'norm' as const, label: 'Row %' },
          ]}
          value={mode}
          onChange={setMode}
        />
      }
      {...(className ? { className } : {})}
      isLoading={isLoading}
      error={error}
      onRetry={onRetry}
      isEmpty={!isLoading && !error && bins.total === 0}
      emptyText="No hourly activity in this range"
    >
      {(ref) => <WorkHeatmap instanceRef={ref} bins={bins} mode={mode} />}
    </ChartCard>
  );
}

function WorkHeatmap({
  instanceRef,
  bins,
  mode,
}: {
  instanceRef: ChartRef;
  bins: ReturnType<typeof binHeatmap>;
  mode: 'abs' | 'norm';
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const source = mode === 'abs' ? bins.abs : bins.norm;
    // bins are indexed by weekday (0=Sun); rows are in display order
    const rows = weekdayOrder(displayWeekStart());
    const workweek = displayWorkweek();
    const weekdayAt = (row: number): number => rows[row] ?? row;
    const data: Array<[number, number, number]> = [];
    for (let r = 0; r < 7; r++) {
      for (let h = 0; h < 24; h++) {
        data.push([h, r, source[weekdayAt(r)]?.[h] ?? 0]);
      }
    }
    const maxV = mode === 'abs' ? bins.max : 1;
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0];
          const v = (p?.value ?? [0, 0, 0]) as [number, number, number];
          const wd = weekdayAt(v[1]);
          const abs = bins.abs[wd]?.[v[0]] ?? 0;
          const share = bins.total > 0 ? abs / bins.total : 0;
          return `<b>${WEEKDAY_LABELS[wd] ?? ''} ${String(v[0]).padStart(2, '0')}:00</b><br/>${fmtTokens(abs)} tokens · ${fmtPct(share, 1)} of total`;
        },
      },
      grid: { left: 8, right: 8, top: 8, bottom: 40, containLabel: true },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => `${h}`),
        splitArea: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 10, interval: 2 },
      },
      yAxis: {
        type: 'category',
        data: rows.map((wd) => WEEKDAY_LABELS[wd] ?? ''),
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10.5,
          // keyed by the label, not the index: ECharts' index counts only the labels it shows
          color: (value: unknown) =>
            workweek.has(WEEKDAY_LABELS.findIndex((l) => l === value)) ? t.muted : `${t.muted}88`,
        },
      },
      visualMap: {
        min: 0,
        max: maxV || 1,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 90,
        textStyle: { color: t.muted, fontSize: 9 },
        inRange: {
          color: t.isDark
            ? ['#171c27', '#3d2f2a', '#7a4a37', '#b96a4b', t.accent, '#f0a984']
            : ['#f1f5f9', '#fde8df', '#f4bfa4', t.accent, '#b4512f'],
        },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderColor: t.card, borderWidth: 1.5, borderRadius: 2 },
          emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.4)' } },
          ...(bins.peak && mode === 'abs'
            ? {
                markPoint: {
                  symbol: 'pin',
                  symbolSize: 26,
                  itemStyle: { color: t.accent2 },
                  label: { show: false },
                  data: [{ name: 'Peak', coord: [bins.peak.hour, rows.indexOf(bins.peak.weekday)], value: bins.peak.value }],
                },
              }
            : {}),
        },
      ],
    };
  }, [bins, mode, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}
