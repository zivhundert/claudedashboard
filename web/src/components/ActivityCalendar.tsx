import { useMemo } from 'react';
import type { CalendarDay } from '@dash/shared';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { fmtCost, fmtNumber, fmtSigned } from '@/lib/format';
import { displayWeekStart, nowLocal } from '@/lib/time';

export type CalendarMetric = 'sessions' | 'netLines' | 'cost';

/** Segmented-control options shared by every calendar card. */
export const CALENDAR_METRIC_OPTIONS = [
  { id: 'sessions' as const, label: 'Sessions' },
  { id: 'netLines' as const, label: 'Net lines' },
  { id: 'cost' as const, label: 'Cost' },
];

/**
 * GitHub-style trailing-12-months activity heatmap over CalendarDay rows.
 * Works for a single user (profile) or the whole org (overview).
 */
export function ActivityCalendar({
  instanceRef,
  data,
  metric,
}: {
  instanceRef: ChartRef;
  data: CalendarDay[];
  metric: CalendarMetric;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const value = (d: CalendarDay) =>
      metric === 'sessions' ? d.sessions : metric === 'netLines' ? d.netLines : d.costCents;
    const cells = data.map((d) => [d.date, value(d)] as [string, number]);
    const byDate = new Map(data.map((d) => [d.date, d]));
    const maxAbs = Math.max(1, ...cells.map(([, v]) => Math.abs(v)));
    // netLines is signed — use a diverging scale centered at 0 so heavy-deletion
    // days read as cool/negative instead of blending into empty cells.
    const diverging = metric === 'netLines';
    const localToday = nowLocal();
    const end = localToday.toISODate();
    const start = localToday.minus({ months: 12 }).plus({ days: 1 }).toISODate();
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0];
          const v = (p?.value ?? ['', 0]) as [string, number];
          const day = byDate.get(v[0]);
          if (!day) return `${v[0]}: no activity`;
          return `<b>${v[0]}</b><br/>${fmtNumber(day.sessions)} sessions · ${fmtSigned(day.netLines)} lines · ${fmtCost(day.costCents)}`;
        },
      },
      visualMap: {
        min: diverging ? -maxAbs : 0,
        max: maxAbs,
        show: false,
        inRange: {
          color: diverging
            ? (t.isDark
                ? ['#5a7bc2', '#2c3a5c', '#1a2030', '#7a4a37', '#f0a984'] // negative→blue, ~0→base, positive→warm
                : ['#3b6cc7', '#c7d7f2', '#eef2f7', '#f4bfa4', '#b4512f'])
            : (t.isDark
                ? ['#1a2030', '#3d2f2a', '#7a4a37', t.accent, '#f0a984']
                : ['#eef2f7', '#fde8df', '#f4bfa4', t.accent, '#b4512f']),
        },
      },
      calendar: {
        top: 24,
        left: 28,
        right: 8,
        bottom: 8,
        range: [start, end],
        cellSize: ['auto', 13],
        itemStyle: { color: t.isDark ? '#151a24' : '#f8fafc', borderColor: t.card, borderWidth: 2 },
        splitLine: { lineStyle: { color: t.border, width: 1 } },
        // nameMap is always Sunday-first; firstDay (WEEK_START) only rotates it
        dayLabel: { color: t.muted, fontSize: 9, firstDay: displayWeekStart(), nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] },
        monthLabel: { color: t.muted, fontSize: 10 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: cells,
        },
      ],
    };
  }, [data, metric, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-56" />;
}
