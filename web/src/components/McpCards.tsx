import { useMemo, useState } from 'react';
import type { Granularity, McpResponse } from '@dash/shared';
import { useChartTheme, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtCost, fmtNumber, fmtPct, fmtTokens } from '@/lib/format';
import { ChartCard } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EntityName } from '@/components/EntityName';

type Drill = ((t: BreakdownTarget) => void) | undefined;

/** 'mcp__server__tool' → parts; server naming follows the telemetry tool name. */
export function splitMcpName(toolName: string): { server: string; tool: string } {
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  return sep > 0 ? { server: rest.slice(0, sep), tool: rest.slice(sep + 2) } : { server: rest, tool: rest };
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

export function McpKpis({
  mcp,
  loading,
  noData,
  noDataText = 'Waiting for telemetry',
}: {
  mcp: McpResponse | undefined;
  loading: boolean;
  noData: boolean;
  noDataText?: string;
}) {
  if (loading || !mcp) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const calls = mcp.daily.reduce((s, d) => s + d.toolCalls, 0);
  const callFailures = mcp.daily.reduce((s, d) => s + d.toolFailures, 0);
  const connections = mcp.daily.reduce((s, d) => s + d.connections, 0);
  const connFailures = mcp.daily.reduce((s, d) => s + d.connectionFailures, 0);
  const activeServers = mcp.servers.filter((s) => s.toolCalls > 0).length;
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="MCP tool calls"
        {...(noData ? { display: '—' } : { value: calls })}
        metricKey="mcpUsage"
        footer={
          noData
            ? noDataText
            : callFailures > 0
              ? `${fmtNumber(callFailures)} failed (${fmtPct(callFailures / Math.max(1, calls))})`
              : 'no failures'
        }
      />
      <StatCard
        label="MCP tools used"
        {...(noData ? { display: '—' } : { value: mcp.tools.length })}
        metricKey="mcpUsage"
        footer={noData ? noDataText : 'distinct tools invoked in range'}
      />
      <StatCard
        label="Servers"
        {...(noData ? { display: '—' } : { value: mcp.servers.length })}
        metricKey="mcpUsage"
        footer={noData ? noDataText : `${fmtNumber(activeServers)} with tool calls`}
      />
      <StatCard
        label="Connections"
        {...(noData ? { display: '—' } : { value: connections })}
        metricKey="mcpUsage"
        footer={noData ? noDataText : connFailures > 0 ? `${fmtNumber(connFailures)} failed` : 'no connection failures'}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Servers (used servers by default — registering a server creates a row whether
// or not anyone ever called it, and those crowd out the ones people actually use)
// ---------------------------------------------------------------------------

export function McpServersCard({
  rows,
  isLoading,
  noData,
  onDrill,
  chartId = 'mcp-servers-page',
  className = 'col-span-12 lg:col-span-7',
  noDataText = 'Waiting for telemetry events',
}: {
  rows: McpResponse['servers'];
  isLoading: boolean;
  noData: boolean;
  /** omit for a single person's view — the Users column is then hidden */
  onDrill?: Drill;
  chartId?: string;
  className?: string;
  noDataText?: string;
}) {
  const [showUnused, setShowUnused] = useState(false);
  const unused = rows.filter((r) => r.toolCalls === 0).length;
  const visible = useMemo(() => (showUnused ? rows : rows.filter((r) => r.toolCalls > 0)), [rows, showUnused]);
  return (
    <ChartCard
      title="MCP servers"
      chartId={chartId}
      metricKey="mcpUsage"
      subtitle={onDrill ? 'Connected servers — calls, health, and who uses them' : 'Connected servers — calls and health'}
      infoExtra="Per-server call counts come from MCP-name telemetry; events ingested before the dashboard learned to read them were counted under an anonymous mcp_tool bucket and don’t appear per server. Servers with no tool calls in range are hidden by default."
      {...(unused > 0
        ? {
            actions: (
              <button
                type="button"
                onClick={() => setShowUnused((v) => !v)}
                aria-pressed={showUnused}
                className="rounded-md border border-border bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-fg"
              >
                {showUnused ? 'Hide unused' : `Show ${fmtNumber(unused)} unused`}
              </button>
            ),
          }
        : {})}
      className={className}
      noExport
      isLoading={isLoading}
      isEmpty={noData || visible.length === 0}
      emptyText={
        noData ? noDataText : rows.length > 0 ? 'No server made a tool call in this range' : 'No MCP activity in this range'
      }
    >
      <ServersTable rows={visible} onDrill={onDrill} />
    </ChartCard>
  );
}

function ServersTable({ rows, onDrill }: { rows: McpResponse['servers']; onDrill: Drill }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.toolCalls - a.toolCalls || b.connections - a.connections),
    [rows],
  );
  const headers = ['Server', 'Calls', 'Failures', 'Tokens', 'Cost', 'Connections', ...(onDrill ? ['Users'] : [])];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i > 0 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const failRate = s.toolCalls > 0 ? s.toolFailures / s.toolCalls : 0;
            return (
              <tr key={s.serverName} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
                <td className="max-w-52 px-2.5 py-1.5 font-mono text-[12px] font-medium">
                  <EntityName kind="mcp" name={s.serverName} />
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-[12.5px]">{fmtNumber(s.toolCalls)}</td>
                <td
                  className={cn(
                    'whitespace-nowrap px-2.5 py-1.5 text-right text-xs',
                    s.toolFailures === 0 ? 'text-muted' : failRate > 0.1 ? 'font-medium text-risk' : 'font-medium text-warn',
                  )}
                >
                  {fmtNumber(s.toolFailures)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">{fmtTokens(s.tokens)}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">{fmtCost(s.costCents)}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs">
                  <span className="text-muted">{fmtNumber(s.connections)}</span>
                  {s.connectionFailures > 0 && (
                    <span className="ml-1 font-medium text-risk">· {fmtNumber(s.connectionFailures)} failed</span>
                  )}
                </td>
                {onDrill && (
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                    <DrillCount
                      value={s.users}
                      onClick={() =>
                        onDrill({ dimension: 'mcp', entity: s.serverName, title: `MCP server · ${s.serverName}` })
                      }
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP tools (all tools, name filter — mirrors the Skills card)
// ---------------------------------------------------------------------------

export function McpToolsCard({
  rows,
  isLoading,
  noData,
  onDrill,
  chartId = 'mcp-tools',
  className = 'col-span-12 lg:col-span-5',
  noDataText = 'Waiting for telemetry events',
}: {
  rows: McpResponse['tools'];
  isLoading: boolean;
  noData: boolean;
  onDrill?: Drill;
  chartId?: string;
  className?: string;
  noDataText?: string;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const filtered = useMemo(() => (q ? rows.filter((r) => r.toolName.toLowerCase().includes(q)) : rows), [rows, q]);
  return (
    <ChartCard
      title="MCP tools"
      chartId={chartId}
      metricKey="mcpUsage"
      subtitle="Every MCP tool invoked in range"
      actions={
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tools…"
          aria-label="Filter MCP tools by name"
          className="w-32 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none transition-colors placeholder:text-muted focus:border-accent"
        />
      }
      className={className}
      noExport
      isLoading={isLoading}
      isEmpty={noData || filtered.length === 0}
      emptyText={noData ? noDataText : q && rows.length > 0 ? 'No tools match the filter' : 'No MCP tool calls in this range'}
    >
      <McpToolsList rows={filtered} onDrill={onDrill} />
    </ChartCard>
  );
}

function McpToolsList({ rows, onDrill }: { rows: McpResponse['tools']; onDrill: Drill }) {
  void onDrill; // people drill-down lives inside the detail drawer now
  const sorted = useMemo(() => [...rows].sort((a, b) => b.uses - a.uses), [rows]);
  const max = sorted[0]?.uses ?? 0;
  return (
    <ul className="space-y-1.5 py-1">
      {sorted.map((r) => {
        const { server, tool } = splitMcpName(r.toolName);
        const decisions = r.accepted + r.rejected;
        return (
          <li key={r.toolName} className="flex items-center gap-2.5">
            <span className="flex w-48 min-w-0 shrink-0 flex-col">
              <EntityName kind="tool" name={r.toolName} label={tool} className="font-mono text-[11.5px]" />
              <span className="truncate text-[9.5px] text-muted" title={server}>
                {server}
              </span>
            </span>
            <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
              <span
                className="block h-full rounded-full bg-accent2"
                style={{ width: `${max > 0 ? Math.max(2, Math.round((r.uses / max) * 100)) : 0}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-xs">{fmtNumber(r.uses)}</span>
            <span className="w-14 shrink-0 text-right text-[10px] text-muted">
              {r.successRate !== null ? (
                <Tip content={`success rate over ${fmtNumber(r.judged)} calls`}>
                  <span className={cn(r.successRate < 0.7 && 'font-medium text-risk')}>{fmtPct(r.successRate)} ok</span>
                </Tip>
              ) : decisions > 0 ? (
                <Tip content={`${fmtNumber(r.accepted)} accepted / ${fmtNumber(r.rejected)} rejected`}>
                  <span>{fmtPct(r.accepted / decisions)} acc</span>
                </Tip>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export function McpTrendCard({
  rows,
  gran,
  isLoading,
  noData,
  chartId = 'mcp-trend',
  className = 'col-span-12',
  noDataText = 'Waiting for telemetry events',
}: {
  rows: McpResponse['daily'];
  gran: Granularity;
  isLoading: boolean;
  noData: boolean;
  chartId?: string;
  className?: string;
  noDataText?: string;
}) {
  return (
    <ChartCard
      title="MCP activity over time"
      chartId={chartId}
      metricKey="mcpUsage"
      subtitle="Tool calls, failures, and server connections"
      className={className}
      isLoading={isLoading}
      isEmpty={noData || rows.length === 0}
      emptyText={noData ? noDataText : 'No MCP activity in this range'}
    >
      {(ref) => <McpTrend instanceRef={ref} rows={rows} gran={gran} />}
    </ChartCard>
  );
}

function McpTrend({ instanceRef, rows, gran }: { instanceRef: ChartRef; rows: McpResponse['daily']; gran: Granularity }) {
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
          name: 'calls',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
          splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
        },
        {
          type: 'value',
          name: 'conns',
          nameGap: NAMED_AXIS_NAME_GAP,
          nameTextStyle: { color: t.muted, fontSize: 10 },
          minInterval: 1,
          axisLabel: { color: t.muted, fontSize: 10.5 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Tool calls',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: t.accent2, opacity: 0.85, borderRadius: [3, 3, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.toolCalls)),
        },
        {
          name: 'Call failures',
          type: 'line',
          smooth: true,
          symbolSize: 4,
          lineStyle: { color: t.risk, width: 1.5, type: 'dashed' },
          itemStyle: { color: t.risk },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.toolFailures)),
        },
        {
          name: 'Connections',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 5,
          lineStyle: { color: t.accent, width: 2 },
          itemStyle: { color: t.accent },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.connections)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}
