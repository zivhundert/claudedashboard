/**
 * Tool usage, plugin, version and model-mix cards shared by the org Skills
 * page and the Personal page (scoped to one user there — no drill-downs).
 */
import { useMemo } from 'react';
import type { EcosystemResponse, ToolUsageRow } from '@dash/shared';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { fmtCost, fmtNumber, fmtPct, fmtTokens } from '@/lib/format';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EntityName } from '@/components/EntityName';

// ---------------------------------------------------------------------------
// Tool usage list (HTML bars — handles MCP chips + acceptance labels)
// ---------------------------------------------------------------------------

export function ToolUsageList({
  rows,
  onDrill,
  limit = 15,
}: {
  rows: ToolUsageRow[];
  /** omit on a single person's page — tool names are then plain text */
  onDrill?: ((t: BreakdownTarget) => void) | undefined;
  limit?: number;
}) {
  void onDrill; // people drill-down lives inside the detail drawer now
  const top = useMemo(() => [...rows].sort((a, b) => b.uses - a.uses).slice(0, limit), [rows, limit]);
  const max = top[0]?.uses ?? 0;
  return (
    <ul className="space-y-1.5 py-1">
      {top.map(({ toolName, uses, accepted, rejected }) => {
        const isMcp = toolName.startsWith('mcp__');
        const displayName = isMcp ? toolName.slice('mcp__'.length) : toolName;
        const decisions = accepted + rejected;
        return (
          <li key={toolName} className="flex items-center gap-2.5">
            <span className="flex w-40 min-w-0 shrink-0 items-center gap-1.5">
              {isMcp && (
                <span className="rounded border border-accent2/40 bg-accent2/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-accent2">
                  mcp
                </span>
              )}
              <EntityName kind="tool" name={toolName} label={displayName} className="font-mono text-[11.5px]" />
            </span>
            <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
              <span
                className={cn('block h-full rounded-full', isMcp ? 'bg-accent2' : 'bg-accent')}
                style={{ width: `${max > 0 ? Math.max(2, Math.round((uses / max) * 100)) : 0}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right text-xs">{fmtNumber(uses)}</span>
            <span className="w-14 shrink-0 text-right text-[10px] text-muted">
              {decisions > 0 && (
                <Tip content={`${fmtNumber(accepted)} accepted / ${fmtNumber(rejected)} rejected`}>
                  <span>{fmtPct(accepted / decisions)} acc</span>
                </Tip>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PluginsList({
  rows,
  onDrill,
}: {
  rows: EcosystemResponse['plugins'];
  /** omit on a single person's page — the user count is then hidden */
  onDrill?: ((t: BreakdownTarget) => void) | undefined;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.loads - a.loads), [rows]);
  const maxLoads = sorted[0]?.loads ?? 0;
  return (
    <ul className="space-y-1.5 py-1">
      {sorted.map((p) => (
        <li key={p.pluginName} className="flex items-center gap-2.5">
          <EntityName kind="plugin" name={p.pluginName} className="w-44 shrink-0 font-mono text-[11.5px]" />
          <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
            <span
              className="block h-full rounded-full bg-accent2"
              style={{ width: `${maxLoads > 0 ? Math.max(2, Math.round((p.loads / maxLoads) * 100)) : 0}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-xs">{fmtNumber(p.loads)}</span>
          <span className="w-32 shrink-0 text-right text-[10.5px] text-muted">
            {fmtNumber(p.installs)} installs
            {onDrill && (
              <>
                {' · '}
                <DrillCount
                  value={p.users}
                  suffix=" users"
                  onClick={() =>
                    onDrill({
                      dimension: 'plugin',
                      entity: p.pluginName,
                      title: `Plugin · ${p.pluginName}`,
                    })
                  }
                />
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VersionDriftBars({
  rows,
  onDrill,
}: {
  rows: EcosystemResponse['versions'];
  /** omit on a single person's page — no "latest" badge, no user counts */
  onDrill?: ((t: BreakdownTarget) => void) | undefined;
}) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.appVersion.localeCompare(a.appVersion, undefined, { numeric: true })),
    [rows],
  );
  const latest = sorted[0]?.appVersion;
  const maxUsers = rows.reduce((m, r) => Math.max(m, r.users), 0);
  return (
    <ul className="space-y-1.5 py-1">
      {sorted.map((v) => {
        const isLatest = onDrill !== undefined && v.appVersion === latest;
        return (
          <li key={v.appVersion} className="flex items-center gap-2.5">
            <span className="flex w-36 min-w-0 shrink-0 items-center gap-1.5">
              <span
                className={cn('truncate font-mono text-[11.5px]', isLatest ? 'font-semibold text-fg' : 'text-muted')}
                title={v.appVersion}
              >
                {v.appVersion}
              </span>
              {isLatest && (
                <span className="rounded border border-good/40 bg-good/10 px-1 text-[9px] font-semibold uppercase tracking-wide text-good">
                  latest
                </span>
              )}
            </span>
            <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
              <span
                className={cn('block h-full rounded-full', isLatest ? 'bg-good' : 'bg-fg/30')}
                style={{ width: `${maxUsers > 0 ? Math.max(2, Math.round((v.users / maxUsers) * 100)) : 0}%` }}
              />
            </span>
            {onDrill && (
              <span className={cn('w-16 shrink-0 text-right text-xs', isLatest ? 'text-fg' : 'text-muted')}>
                <DrillCount
                  value={v.users}
                  suffix={v.users === 1 ? ' user' : ' users'}
                  onClick={() =>
                    onDrill({
                      dimension: 'version',
                      entity: v.appVersion,
                      title: `Claude Code ${v.appVersion}`,
                    })
                  }
                />
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ModelMixChart({
  instanceRef,
  rows,
}: {
  instanceRef: ChartRef;
  rows: EcosystemResponse['modelMix'];
}) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const models = [...new Set(rows.map((r) => r.model))].sort();
    const combos = [...new Set(rows.map((r) => `${r.speed} · ${r.effort}`))].sort();
    const value = (model: string, combo: string) =>
      rows
        .filter((r) => r.model === model && `${r.speed} · ${r.effort}` === combo)
        .reduce((acc, r) => acc + r.tokens, 0);
    const costOf = (model: string, combo: string) =>
      rows
        .filter((r) => r.model === model && `${r.speed} · ${r.effort}` === combo)
        .reduce((acc, r) => acc + r.costCents, 0);
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
          const model = String(items[0]?.name ?? '');
          const lines = items
            .filter((p) => typeof p.value === 'number' && p.value > 0)
            .map((p) => {
              const combo = p.seriesName ?? '';
              return `${p.marker ?? ''}${combo}: <b>${fmtTokens(p.value as number)}</b> · ${fmtCost(costOf(model, combo))}`;
            });
          return `<div style="font-size:11px"><b>${model}</b></div>${lines.join('<br/>')}`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8, type: 'scroll' },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: {
        type: 'category',
        data: models,
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: {
          color: t.muted,
          fontSize: 10.5,
          formatter: (name: string) => (name.length > 18 ? `${name.slice(0, 16)}…` : name),
        },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtTokens(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      series: combos.map((combo) => ({
        name: combo,
        type: 'bar' as const,
        stack: 'mix',
        barMaxWidth: 32,
        emphasis: { focus: 'series' as const },
        data: models.map((m) => value(m, combo)),
      })),
    };
  }, [rows, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-72" />;
}
