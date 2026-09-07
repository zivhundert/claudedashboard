import { useMemo } from 'react';
import { DateTime } from 'luxon';
import type { ActivityResponse } from '@dash/shared';
import { useChartTheme, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { displayZone } from '@/lib/time';
import { fmtNumber } from '@/lib/format';
import { ChartCard } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';

export type LiveHour = ActivityResponse['hourly'][number];

export function LivePulseDot() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2 py-0.5 text-[10.5px] font-semibold text-good">
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-good opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-good" />
      </span>
      Live
    </span>
  );
}

/** 'YYYY-MM-DDTHH:00:00Z' → "14:00–15:00 · Sep 7" in the display zone. */
export function fmtLiveHour(hourUtc: string): string {
  const dt = DateTime.fromISO(hourUtc, { zone: 'utc' }).setZone(displayZone());
  if (!dt.isValid) return hourUtc;
  return `${dt.toFormat('HH:00')}–${dt.plus({ hours: 1 }).toFormat('HH:00')} · ${dt.toFormat('LLL d')}`;
}

/**
 * Hourly prompts / API requests (and, org-wide, active people) over the last
 * 24h from the live OTel feed. The org Activity page and the Personal page
 * share it; `onHourClick` (org only) opens the "who was active" drill-down.
 */
export function LiveTodayCard({
  activity,
  isLoading,
  noData,
  chartId = 'live-today',
  className = 'col-span-12 lg:col-span-8',
  showPeople = true,
  noDataText = 'Waiting for telemetry events',
  onHourClick,
}: {
  activity: ActivityResponse | undefined;
  isLoading: boolean;
  noData: boolean;
  chartId?: string;
  className?: string;
  /** false on the Personal page — one person's "active people" line is always 1 */
  showPeople?: boolean;
  noDataText?: string;
  onHourClick?: ((hour: LiveHour) => void) | undefined;
}) {
  const hours = useMemo(() => {
    const cutoff = DateTime.utc().minus({ hours: 24 });
    return (activity?.hourly ?? [])
      .filter((h) => {
        const dt = DateTime.fromISO(h.hourUtc, { zone: 'utc' });
        return dt.isValid && dt >= cutoff;
      })
      .sort((a, b) => (a.hourUtc < b.hourUtc ? -1 : 1));
  }, [activity]);

  const info =
    (showPeople ? 'Hourly prompts, API requests, and active people' : 'Hourly prompts and API requests') +
    ' over the last 24 hours, straight from the live OTel feed. Auto-refreshes every 60 seconds.' +
    (onHourClick ? ' Click an hour to see who was active.' : '');

  return (
    <ChartCard
      title="Live today"
      chartId={chartId}
      metricKey="promptCadence"
      infoExtra={info}
      subtitle={`Last 24h · ${displayZone()} hours`}
      actions={<LivePulseDot />}
      className={className}
      isLoading={isLoading}
      isEmpty={noData || hours.length === 0}
      emptyText={noData ? noDataText : 'No activity in the last 24 hours'}
    >
      {(ref) => <LiveTodayChart instanceRef={ref} hours={hours} showPeople={showPeople} onHourClick={onHourClick} />}
    </ChartCard>
  );
}

function LiveTodayChart({
  instanceRef,
  hours,
  showPeople,
  onHourClick,
}: {
  instanceRef: ChartRef;
  hours: LiveHour[];
  showPeople: boolean;
  onHourClick: ((hour: LiveHour) => void) | undefined;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const labels = hours.map((h) =>
      DateTime.fromISO(h.hourUtc, { zone: 'utc' }).setZone(displayZone()).toFormat('HH:00'),
    );
    const series: NonNullable<EChartsOption['series']> = [
      {
        name: 'Prompts',
        type: 'bar',
        stack: 'live',
        barMaxWidth: 14,
        cursor: onHourClick ? 'pointer' : 'default',
        itemStyle: { color: t.accent, opacity: 0.9 },
        data: hours.map((h) => h.prompts),
      },
      {
        name: 'API requests',
        type: 'bar',
        stack: 'live',
        barMaxWidth: 14,
        cursor: onHourClick ? 'pointer' : 'default',
        itemStyle: { color: t.accent2, opacity: 0.75 },
        data: hours.map((h) => h.apiRequests),
      },
    ];
    if (showPeople) {
      series.push({
        name: 'Active people',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbolSize: 4,
        cursor: onHourClick ? 'pointer' : 'default',
        lineStyle: { color: t.good, width: 2 },
        itemStyle: { color: t.good },
        data: hours.map((h) => h.activeUsers),
      });
    }
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
        axisLabel: { color: t.muted, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          name: 'events',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: showPeople ? 'people' : '',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          minInterval: 1,
          show: showPeople,
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series,
    };
  }, [hours, showPeople, onHourClick, t]);

  return (
    <EChart
      option={option}
      instanceRef={instanceRef}
      className="h-72"
      onClickPoint={(p) => {
        if (!onHourClick || typeof p.dataIndex !== 'number') return;
        const hour = hours[p.dataIndex];
        if (hour) onHourClick(hour);
      }}
    />
  );
}
