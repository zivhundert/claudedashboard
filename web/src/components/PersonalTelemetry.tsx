
/**
 * The Personal page's telemetry sections — the org Activity, MCP, Skills
 * (tools/plugins/version) and Health boards, scoped to one user and ordered
 * as a review story. Each section hides entirely when the data source has no
 * telemetry packs, and collapses to one honest line when this person's
 * machine ships no telemetry for the range.
 */
import { useMemo } from 'react';
import type { Granularity, UserProfileResponse } from '@dash/shared';
import {
  useActivity,
  useCapabilities,
  useEcosystem,
  useGovernance,
  useMcp,
  useReliability,
  useSkills,
} from '@/lib/queries';
import { useChartTheme, asTipArray, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { bucketRows, previousRange, sumBy } from '@/lib/time';
import { fmtBucket, fmtCost, fmtNumber, fmtPct } from '@/lib/format';
import { ChartCard } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { ErrorCard } from '@/components/ErrorCard';
import { StatCard } from '@/components/StatCard';
import { SectionHeader } from '@/components/SectionHeader';
import {
  ActivityKpis,
  EngagedTimeTrend,
  PromptsSessionsTrend,
  SessionLengthCard,
  orgMediansOf,
} from '@/components/ActivityCharts';
import { LiveTodayCard } from '@/components/LiveTodayCard';
import { McpServersCard, McpToolsCard, McpTrendCard } from '@/components/McpCards';
import { ModelMixChart, PluginsList, ToolUsageList, VersionDriftBars } from '@/components/EcosystemCards';
import {
  ByModelTable,
  DecisionSourcesStacked,
  ErrorStatusDonut,
  ErrorTrend,
  PermissionModesTable,
  ReliabilityKpis,
} from '@/components/HealthCards';
import { TableSkeleton } from '@/components/Skeleton';

const LIVE_REFETCH_MS = 60_000;
const NO_DATA = 'No telemetry from this person in range';

interface SectionProps {
  userId: number;
  from: string;
  to: string;
  gran: Granularity;
}

/** One quiet line instead of a wall of empty cards. */
function TelemetryEmpty({ what }: { what: string }) {
  return (
    <div className="card col-span-12 px-4 py-3 text-xs text-muted">
      No {what} telemetry from this person in the selected range.
    </div>
  );
}

function usePacksEnabled(): boolean {
  return useCapabilities().data?.capabilities?.telemetryPacks !== false;
}

// ---------------------------------------------------------------------------
// Rhythm — how much, how often, right now
// ---------------------------------------------------------------------------

export function PersonalActivitySection({ userId, from, to, gran }: SectionProps) {
  const enabled = usePacksEnabled();
  const activityQ = useActivity({ from, to, userId }, { refetchMs: LIVE_REFETCH_MS, enabled });
  const prevRange = useMemo(() => previousRange(from, to), [from, to]);
  const prevQ = useActivity({ from: prevRange.from, to: prevRange.to, userId }, { enabled });
  const orgQ = useActivity({ from, to }, { enabled });
  if (!enabled) return null;

  const activity = activityQ.data;
  const noData = !!activity && !activity.hasData;
  if (activityQ.error) {
    return (
      <div className="col-span-12">
        <ErrorCard error={activityQ.error} onRetry={() => void activityQ.refetch()} />
      </div>
    );
  }
  if (noData) return <TelemetryEmpty what="activity" />;

  return (
    <>
      <ActivityKpis
        activity={activity}
        loading={activityQ.isLoading}
        noData={noData}
        noDataText={NO_DATA}
        prev={prevQ.data?.hasData ? prevQ.data.totals : undefined}
        orgMedian={orgMediansOf(orgQ.data)}
      />
      <ChartCard
        title="Engaged time"
        chartId="profile-engaged-time"
        metricKey="activeTime"
        subtitle="Hands-on vs Claude-working time, stacked"
        className="col-span-12 lg:col-span-7"
        isLoading={activityQ.isLoading}
        isEmpty={!!activity && activity.daily.length === 0}
        emptyText="No engaged time in this range"
      >
        {(ref) => <EngagedTimeTrend instanceRef={ref} rows={activity?.daily ?? []} gran={gran} />}
      </ChartCard>
      <ChartCard
        title="Prompts & sessions"
        chartId="profile-prompts-sessions"
        metricKey="promptCadence"
        subtitle="Prompts (bars) and sessions (line)"
        className="col-span-12 lg:col-span-5"
        isLoading={activityQ.isLoading}
        isEmpty={!!activity && activity.daily.length === 0}
        emptyText="No prompts in this range"
      >
        {(ref) => <PromptsSessionsTrend instanceRef={ref} rows={activity?.daily ?? []} gran={gran} />}
      </ChartCard>
      <LiveTodayCard
        activity={activity}
        isLoading={activityQ.isLoading}
        noData={noData}
        chartId="profile-live-today"
        className="col-span-12 lg:col-span-8"
        showPeople={false}
        noDataText={NO_DATA}
      />
      <SessionLengthCard
        activity={activity}
        isLoading={activityQ.isLoading}
        noData={noData}
        chartId="profile-session-length"
        noDataText={NO_DATA}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Toolkit — tools, MCP, plugins, version
// ---------------------------------------------------------------------------

export function PersonalToolkitSection({
  userId,
  from,
  to,
  gran,
  terminalMix,
  showSurfaces,
}: SectionProps & { terminalMix: UserProfileResponse['terminalMix']; showSurfaces: boolean }) {
  const enabled = usePacksEnabled();
  const skillsQ = useSkills({ from, to, userId }, enabled);
  const mcpQ = useMcp({ from, to, userId }, enabled);
  const ecoQ = useEcosystem({ from, to, userId }, enabled);

  const surfaces = showSurfaces && (
    <ChartCard
      title="Where I use it"
      chartId="profile-surfaces"
      metricKey="terminalMix"
      subtitle="Sessions by surface — CLI, IDE, CI"
      className="col-span-12 lg:col-span-5"
      isEmpty={terminalMix.length === 0}
      emptyText="No session data in this range"
    >
      {(ref) => <SurfacesDonut instanceRef={ref} mix={terminalMix} />}
    </ChartCard>
  );

  if (!enabled) return surfaces ? <>{surfaces}</> : null;

  const tools = skillsQ.data?.tools ?? [];
  const mcp = mcpQ.data;
  const mcpNoData = !!mcp && !mcp.hasData;
  const eco = ecoQ.data;

  return (
    <>
      <ChartCard
        title="Tools"
        chartId="profile-tools"
        metricKey="toolsUsage"
        subtitle="Built-in and MCP tools by uses, with acceptance where the tool asks"
        className="col-span-12 lg:col-span-7"
        noExport
        isLoading={skillsQ.isLoading}
        error={skillsQ.error}
        onRetry={() => void skillsQ.refetch()}
        isEmpty={tools.length === 0}
        emptyText={NO_DATA}
      >
        <ToolUsageList rows={tools} limit={20} />
      </ChartCard>
      {surfaces}

      {mcpQ.error ? (
        <div className="col-span-12">
          <ErrorCard error={mcpQ.error} onRetry={() => void mcpQ.refetch()} />
        </div>
      ) : mcpNoData ? (
        <TelemetryEmpty what="MCP" />
      ) : (
        <>
          <McpServersCard rows={mcp?.servers ?? []} isLoading={mcpQ.isLoading} noData={mcpNoData} chartId="profile-mcp-servers" noDataText={NO_DATA} />
          <McpToolsCard rows={mcp?.tools ?? []} isLoading={mcpQ.isLoading} noData={mcpNoData} chartId="profile-mcp-tools" noDataText={NO_DATA} />
          <McpTrendCard rows={mcp?.daily ?? []} gran={gran} isLoading={mcpQ.isLoading} noData={mcpNoData} chartId="profile-mcp-trend" noDataText={NO_DATA} />
        </>
      )}

      <ChartCard
        title="Plugins"
        chartId="profile-plugins"
        metricKey="pluginAdoption"
        subtitle="Installed and actually loaded"
        className="col-span-12 lg:col-span-7"
        noExport
        isLoading={ecoQ.isLoading}
        error={ecoQ.error}
        onRetry={() => void ecoQ.refetch()}
        isEmpty={(eco?.plugins.length ?? 0) === 0}
        emptyText="No plugin activity in this range"
      >
        <PluginsList rows={eco?.plugins ?? []} />
      </ChartCard>
      <ChartCard
        title="Claude Code version"
        chartId="profile-version"
        metricKey="versionDrift"
        subtitle="Last version seen from this person’s machine"
        className="col-span-12 lg:col-span-5"
        noExport
        isLoading={ecoQ.isLoading}
        isEmpty={(eco?.versions.length ?? 0) === 0}
        emptyText="No version telemetry yet"
      >
        <VersionDriftBars rows={eco?.versions ?? []} />
      </ChartCard>
    </>
  );
}

function SurfacesDonut({ instanceRef, mix }: { instanceRef: ChartRef; mix: UserProfileResponse['terminalMix'] }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(
    () => ({
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
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: { color: t.muted, fontSize: 11 }, icon: 'circle', itemWidth: 8 },
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
    }),
    [mix, t],
  );
  return <EChart option={option} instanceRef={instanceRef} className="h-64" />;
}

// ---------------------------------------------------------------------------
// Health & governance — API reliability, refusals, permission habits
// ---------------------------------------------------------------------------

export function PersonalHealthSection({ userId, from, to, gran }: SectionProps) {
  const enabled = usePacksEnabled();
  const relQ = useReliability({ from, to, userId }, enabled);
  const govQ = useGovernance({ from, to, userId }, enabled);
  if (!enabled) return null;

  const rel = relQ.data;
  const gov = govQ.data;
  const relNoData = !!rel && !rel.hasData;
  const govNoData = !!gov && !gov.hasData;

  return (
    <>
      <SectionHeader title="Health & governance" />
      {relQ.error ? (
        <div className="col-span-12">
          <ErrorCard error={relQ.error} onRetry={() => void relQ.refetch()} />
        </div>
      ) : relNoData ? (
        <TelemetryEmpty what="API reliability" />
      ) : (
        <>
          <ReliabilityKpis rel={rel} loading={relQ.isLoading} noData={relNoData} noDataText={NO_DATA} />
          <ChartCard
            title="Errors over time"
            chartId="profile-error-trend"
            metricKey="errorRate"
            subtitle="API requests (bars) with errors and refusals (lines)"
            className="col-span-12 lg:col-span-8"
            isLoading={relQ.isLoading}
            isEmpty={!!rel && rel.daily.length === 0}
            emptyText="No API requests in this range"
          >
            {(ref) => <ErrorTrend instanceRef={ref} rows={rel?.daily ?? []} gran={gran} />}
          </ChartCard>
          <div className="col-span-12 flex flex-col gap-4 lg:col-span-4">
            <ChartCard
              title="Error status split"
              chartId="profile-error-status"
              metricKey="errorRate"
              subtitle="429 rate limits vs 5xx vs other"
              className="flex-1"
              isLoading={relQ.isLoading}
              isEmpty={!!rel && rel.errorStatuses.e429 + rel.errorStatuses.e5xx + rel.errorStatuses.other === 0}
              emptyText="No API errors in this range 🎉"
            >
              {(ref) => <ErrorStatusDonut instanceRef={ref} rel={rel} />}
            </ChartCard>
            <StatCard
              label="Compactions"
              {...(!rel ? { display: '—' } : { value: rel.totals.compactions })}
              metricKey="compactions"
              footer={rel ? `${fmtNumber(rel.totals.internalErrors)} internal CLI errors in range` : ' '}
            />
          </div>
          <ChartCard
            title="Reliability by model"
            chartId="profile-reliability-by-model"
            metricKey="errorRate"
            className="col-span-12"
            noExport
            isEmpty={!!rel && rel.byModel.length === 0}
            emptyText="No per-model telemetry in this range"
          >
            {relQ.isLoading ? <TableSkeleton rows={3} cols={5} /> : <ByModelTable rows={rel?.byModel ?? []} />}
          </ChartCard>
        </>
      )}

      {govQ.error ? (
        <div className="col-span-12">
          <ErrorCard error={govQ.error} onRetry={() => void govQ.refetch()} />
        </div>
      ) : govNoData ? (
        <TelemetryEmpty what="permission" />
      ) : (
        <>
          <ChartCard
            title="Approval sources"
            chartId="profile-decision-sources"
            metricKey="decisionSources"
            subtitle="How this person’s tool permissions get decided"
            className="col-span-12 lg:col-span-7"
            isLoading={govQ.isLoading}
            isEmpty={!!gov && Object.values(gov.decisionSources).every((v) => v === 0)}
            emptyText="No tool decisions in this range"
          >
            {(ref) => <DecisionSourcesStacked instanceRef={ref} gov={gov} />}
          </ChartCard>
          <ChartCard
            title="Permission modes"
            chartId="profile-permission-modes"
            metricKey="permissionModes"
            subtitle="Mode switches per target mode"
            className="col-span-12 lg:col-span-5"
            noExport
            isLoading={govQ.isLoading}
            isEmpty={!!gov && gov.permissionModes.length === 0}
            emptyText="No mode changes in this range"
          >
            <PermissionModesTable rows={gov?.permissionModes ?? []} />
          </ChartCard>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Cost & efficiency — spend and cache trend + model/speed/effort mix
// ---------------------------------------------------------------------------

export function PersonalCostSection({
  userId,
  from,
  to,
  gran,
  tokensDaily,
}: SectionProps & { tokensDaily: UserProfileResponse['tokensDaily'] }) {
  const enabled = usePacksEnabled();
  const ecoQ = useEcosystem({ from, to, userId }, enabled);
  const eco = ecoQ.data;
  return (
    <>
      <ChartCard
        title="Cost & cache efficiency"
        chartId="profile-cost-cache"
        metricKey="cacheRatio"
        subtitle="Spend (bars) and cache hit rate (line) — the cheapest habit to improve"
        className={enabled ? 'col-span-12 lg:col-span-7' : 'col-span-12'}
        isEmpty={tokensDaily.length === 0}
        emptyText="No token usage in this range"
      >
        {(ref) => <CostCacheTrend instanceRef={ref} rows={tokensDaily} gran={gran} />}
      </ChartCard>
      {enabled && (
        <ChartCard
          title="Model / speed / effort mix"
          chartId="profile-model-speed-mix"
          metricKey="modelSpeedMix"
          subtitle="Tokens by model, stacked by speed × effort"
          className="col-span-12 lg:col-span-5"
          isLoading={ecoQ.isLoading}
          error={ecoQ.error}
          onRetry={() => void ecoQ.refetch()}
          isEmpty={(eco?.modelMix.length ?? 0) === 0}
          emptyText={NO_DATA}
        >
          {(ref) => <ModelMixChart instanceRef={ref} rows={eco?.modelMix ?? []} />}
        </ChartCard>
      )}
    </>
  );
}

function CostCacheTrend({
  instanceRef,
  rows,
  gran,
}: {
  instanceRef: ChartRef;
  rows: UserProfileResponse['tokensDaily'];
  gran: Granularity;
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    const labels = buckets.map((b) => fmtBucket(b.bucket, gran));
    const cost = buckets.map((b) => sumBy(b.rows, (r) => r.costCents));
    const cacheRate = buckets.map((b) => {
      const read = sumBy(b.rows, (r) => r.cacheRead);
      const fresh = sumBy(b.rows, (r) => r.input);
      return read + fresh > 0 ? Math.round((read / (read + fresh)) * 1000) / 10 : null;
    });
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
            const v = typeof p.value === 'number' ? p.value : null;
            const val = v === null ? '—' : p.seriesName === 'Cost' ? fmtCost(v) : fmtPct(v / 100);
            return `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${val}</b>`;
          });
          return `<div style="font-size:11px">${head}</div>${lines.join('<br/>')}`;
        },
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
          name: 'cost',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtCost(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'cache %',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          min: 0,
          max: 100,
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => `${v}%` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Cost',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent, opacity: 0.85, borderRadius: [3, 3, 0, 0] },
          data: cost,
        },
        {
          name: 'Cache hit rate',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          connectNulls: true,
          lineStyle: { color: t.good, width: 2 },
          itemStyle: { color: t.good },
          data: cacheRate,
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}
