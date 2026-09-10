/**
 * The detail card behind any skill / subagent / tool / MCP server / plugin
 * name: what it is, headline numbers for the selected range, lifecycle, a
 * daily trend, related entities (click to hop), and the people behind it.
 * Mounted once in the shell; opened through useEntityStore.
 */
import { useMemo } from 'react';
import { ArrowLeft, Blocks, Bot, Plug, Sparkles, Wrench } from 'lucide-react';
import type { BreakdownDimension, EntityDetailResponse, EntityKind } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useBreakdown, useEntityDetail } from '@/lib/queries';
import { useChartTheme } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtCost, fmtNumber, fmtPct, relativeDate } from '@/lib/format';
import { ENTITY_LABELS, useEntityStore } from '@/state/entity';
import { EChart, type EChartsOption } from '@/components/EChart';
import { BreakdownRow } from '@/components/BreakdownDrawer';
import { EntityName } from '@/components/EntityName';
import { TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/utils';

const ICONS: Record<EntityKind, typeof Sparkles> = {
  skill: Sparkles,
  agent: Bot,
  tool: Wrench,
  mcp: Plug,
  plugin: Blocks,
};

/** Which people drill-down answers "who used this". */
const PEOPLE_DIMENSION: Record<EntityKind, BreakdownDimension> = {
  skill: 'skill',
  agent: 'agent',
  tool: 'tool',
  mcp: 'mcp',
  plugin: 'plugin',
};

const fmtBy = (v: number, f: 'number' | 'cents' | 'pct') =>
  f === 'cents' ? fmtCost(v) : f === 'pct' ? fmtPct(v) : fmtNumber(v);

export function EntityDetailDrawer() {
  const { target, trail, back, close } = useEntityStore();
  const { from, to, gran, teamId } = useRangeParams();
  const range = { from, to, teamId };
  const q = useEntityDetail(target?.kind ?? null, target?.name ?? '', range);
  const people = useBreakdown(target ? PEOPLE_DIMENSION[target.kind] : null, target?.name ?? '', range);
  const Icon = target ? ICONS[target.kind] : Sparkles;

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      className="w-[min(94vw,560px)]"
      title={
        <span className="flex min-w-0 items-center gap-2">
          {trail.length > 0 && (
            <button type="button" onClick={back} aria-label="Back" className="text-muted transition-colors hover:text-fg">
              <ArrowLeft size={15} />
            </button>
          )}
          <Icon size={15} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            {target ? ENTITY_LABELS[target.kind] : ''}
          </span>
          <span className="truncate font-mono text-sm">{target?.name ?? ''}</span>
        </span>
      }
    >
      {q.isLoading && <TableSkeleton rows={6} />}
      {q.error && <ErrorCard error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <Body d={q.data} gran={gran} />}

      {target && (
        <section className="mt-6">
          <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            People in range {people.data ? `(${fmtNumber(people.data.rows.length)})` : ''}
          </h3>
          {people.isLoading && <TableSkeleton rows={3} />}
          {people.error && <ErrorCard error={people.error} onRetry={() => void people.refetch()} compact />}
          {people.data &&
            (people.data.rows.length === 0 ? (
              <p className="text-xs text-muted">Nobody used it in the selected range.</p>
            ) : (
              <div className="space-y-2">
                {people.data.rows.map((r) => (
                  <BreakdownRow key={r.userId} row={r} columns={people.data.columns} />
                ))}
              </div>
            ))}
        </section>
      )}
    </Sheet>
  );
}

function Body({ d, gran }: { d: EntityDetailResponse; gran: 'day' | 'week' | 'month' }) {
  const primary = d.totals[0];
  const rest = d.totals.slice(1);
  const spanDays = Math.max(1, Math.round((Date.parse(d.range.to) - Date.parse(d.range.from)) / 86_400_000) + 1);
  return (
    <div className="space-y-5">
      {/* what it is */}
      {d.facts.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {d.facts.map((f) => (
            <FactRow key={f.label} label={f.label} value={f.value} />
          ))}
          <FactRow label="First seen" value={d.firstSeen ? `${d.firstSeen} (${relativeDate(d.firstSeen)})` : 'never'} />
          <FactRow label="Last seen" value={d.lastSeen ? `${d.lastSeen} (${relativeDate(d.lastSeen)})` : 'never'} />
        </dl>
      )}

      {/* headline numbers */}
      <div>
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
          In range · {d.range.from === d.range.to ? d.range.from : `${d.range.from} → ${d.range.to}`}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {primary && (
            <Tile label={primary.label} value={fmtBy(primary.value, primary.format)} hero />
          )}
          <Tile label="People" value={fmtNumber(d.users)} />
          <Tile label="Active days" value={`${fmtNumber(d.activeDays)} / ${fmtNumber(spanDays)}`} />
          {rest.map((t) => (
            <Tile key={t.key} label={t.label} value={fmtBy(t.value, t.format)} muted={t.value === 0} />
          ))}
        </div>
      </div>

      {/* trend */}
      {d.daily.length > 0 && (
        <div>
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            {d.dailyLabel} per {gran}
          </div>
          <MiniTrend rows={d.daily} gran={gran} />
        </div>
      )}

      {/* related */}
      {d.relatedLabel && (
        <div>
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">{d.relatedLabel}</div>
          {d.related.length === 0 ? (
            <p className="text-xs text-muted">None in the selected range.</p>
          ) : (
            <ul className="space-y-1">
              {d.related.map((r) => (
                <li key={`${r.kind}:${r.name}`} className="flex items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted">{ENTITY_LABELS[r.kind]}</span>
                  <EntityName
                    kind={r.kind}
                    name={r.name}
                    label={r.kind === 'tool' && r.name.startsWith('mcp__') ? r.name.slice(r.name.indexOf('__', 5) + 2) : r.name}
                    className="font-mono text-[11.5px]"
                  />
                  <span className="ml-auto tabular-nums text-muted">{fmtNumber(r.value)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </>
  );
}

function Tile({ label, value, hero = false, muted = false }: { label: string; value: string; hero?: boolean; muted?: boolean }) {
  return (
    <div className={cn('rounded-lg border border-border bg-bg/40 px-2.5 py-2', hero && 'border-accent/40 bg-accent/[0.06]')}>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={cn('mt-0.5 tabular-nums font-semibold', hero ? 'text-lg' : 'text-sm', muted && 'text-muted')}>{value}</div>
    </div>
  );
}

function MiniTrend({ rows, gran }: { rows: EntityDetailResponse['daily']; gran: 'day' | 'week' | 'month' }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const buckets = bucketRows(rows, gran);
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: { trigger: 'axis', backgroundColor: t.card, borderColor: t.border, textStyle: { color: t.fg, fontSize: 12 } },
      grid: { left: 4, right: 4, top: 6, bottom: 2, containLabel: true },
      xAxis: {
        type: 'category',
        data: buckets.map((b) => fmtBucket(b.bucket, gran)),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 9.5 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: t.muted, fontSize: 9.5, formatter: (v: number) => fmtNumber(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.4 } },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 14,
          itemStyle: { color: t.accent, opacity: 0.85, borderRadius: [2, 2, 0, 0] },
          data: buckets.map((b) => sumBy(b.rows, (r) => r.value)),
        },
      ],
    };
  }, [rows, gran, t]);
  return <EChart option={option} className="h-32" />;
}
