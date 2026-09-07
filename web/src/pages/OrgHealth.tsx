import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ShieldAlert } from 'lucide-react';
import type { DecisionSource, GovernanceResponse, Granularity, ReliabilityResponse } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useGovernance, useReliability } from '@/lib/queries';
import { BreakdownDrawer, DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { useChartTheme, asTipArray, type ChartTheme, NAMED_AXIS_GRID_TOP, NAMED_AXIS_NAME_GAP } from '@/lib/chartTheme';
import { bucketRows, sumBy } from '@/lib/time';
import { fmtBucket, fmtNumber, fmtPct } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton, TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Avatar } from '@/components/Avatar';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';
import { Tip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/SectionHeader';
import {
  ByModelTable,
  DecisionSourcesStacked,
  ErrorStatusDonut,
  ErrorTrend,
  PermissionModesTable,
  ReliabilityKpis,
} from '@/components/HealthCards';

export default function OrgHealth() {
  const { from, to, gran, teamId } = useRangeParams();
  const reliabilityQ = useReliability({ from, to, teamId });
  const governanceQ = useGovernance({ from, to, teamId });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const rel = reliabilityQ.data;
  const gov = governanceQ.data;
  const relNoData = !!rel && !rel.hasData;
  const govNoData = !!gov && !gov.hasData;

  if (reliabilityQ.error) {
    return <ErrorCard error={reliabilityQ.error} onRetry={() => void reliabilityQ.refetch()} />;
  }

  return (
    <ChartPage pageId="health">
      <div className="grid grid-cols-12 gap-4">
        {relNoData && govNoData && (
          <TelemetrySetupCard blurb="This view tracks API reliability (errors, refusals, latency) and permission governance from Claude Code’s OpenTelemetry feed." />
        )}

        <SectionHeader title="Reliability" />

        <ReliabilityKpis rel={rel} loading={reliabilityQ.isLoading} noData={relNoData} />

        <ChartCard
          title="Errors over time"
          chartId="error-trend"
          metricKey="errorRate"
          subtitle="API requests (bars) with errors and refusals (lines)"
          className="col-span-12 lg:col-span-8"
          isLoading={reliabilityQ.isLoading}
          isEmpty={relNoData || (!!rel && rel.daily.length === 0)}
          emptyText={relNoData ? 'Waiting for telemetry events' : undefined}
        >
          {(ref) => <ErrorTrend instanceRef={ref} rows={rel?.daily ?? []} gran={gran} />}
        </ChartCard>

        <div className="col-span-12 flex flex-col gap-4 lg:col-span-4">
          <ChartCard
            title="Error status split"
            chartId="error-status-split"
            metricKey="errorRate"
            subtitle="429 rate limits vs 5xx vs other"
            className="flex-1"
            isLoading={reliabilityQ.isLoading}
            isEmpty={
              relNoData ||
              (!!rel &&
                rel.errorStatuses.e429 + rel.errorStatuses.e5xx + rel.errorStatuses.other === 0)
            }
            emptyText={relNoData ? 'Waiting for telemetry events' : 'No API errors in this range 🎉'}
          >
            {(ref) => <ErrorStatusDonut instanceRef={ref} rel={rel} />}
          </ChartCard>
          <StatCard
            label="Compactions"
            {...(relNoData || !rel ? { display: '—' } : { value: rel.totals.compactions })}
            metricKey="compactions"
            footer={
              relNoData || !rel
                ? 'Waiting for telemetry'
                : `${fmtNumber(rel.totals.internalErrors)} internal CLI errors in range`
            }
          />
        </div>

        <ChartCard
          title="Reliability by model"
          chartId="reliability-by-model"
          metricKey="errorRate"
          className="col-span-12"
          noExport
          isEmpty={relNoData || (!!rel && rel.byModel.length === 0)}
          emptyText={relNoData ? 'Waiting for telemetry events' : 'No per-model telemetry in this range'}
        >
          {reliabilityQ.isLoading ? (
            <TableSkeleton rows={4} cols={5} />
          ) : (
            <ByModelTable rows={rel?.byModel ?? []} onDrill={setDrill} />
          )}
        </ChartCard>

        <SectionHeader title="Governance" />

        {governanceQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={governanceQ.error} onRetry={() => void governanceQ.refetch()} />
          </div>
        ) : (
          <>
            <ChartCard
              title="Approval sources"
              chartId="decision-sources"
              metricKey="decisionSources"
              subtitle="How tool permissions get decided across the org"
              className="col-span-12 lg:col-span-7"
              isLoading={governanceQ.isLoading}
              isEmpty={
                govNoData ||
                (!!gov && Object.values(gov.decisionSources).every((v) => v === 0))
              }
              emptyText={govNoData ? 'Waiting for telemetry events' : 'No tool decisions in this range'}
            >
              {(ref) => <DecisionSourcesStacked instanceRef={ref} gov={gov} />}
            </ChartCard>

            <ChartCard
              title="Permission modes"
              chartId="permission-modes"
              metricKey="permissionModes"
              subtitle="Mode switches per target mode"
              className="col-span-12 lg:col-span-5"
              noExport
              isLoading={governanceQ.isLoading}
              isEmpty={govNoData || (!!gov && gov.permissionModes.length === 0)}
              emptyText={govNoData ? 'Waiting for telemetry events' : 'No mode changes in this range'}
            >
              <PermissionModesTable rows={gov?.permissionModes ?? []} onDrill={setDrill} />
            </ChartCard>

            <ChartCard
              title="Governance per person"
              chartId="governance-per-user"
              metricKey="decisionSources"
              infoExtra="Auto-approved = decisions made by config, hooks, or a remembered “always allow” — a high share means a tuned allowlist, not recklessness."
              className="col-span-12"
              noExport
              isEmpty={govNoData || (!!gov && gov.perUser.length === 0)}
              emptyText={govNoData ? 'Waiting for telemetry events' : 'No per-user telemetry in this range'}
            >
              {governanceQ.isLoading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : (
                <PerUserGovernanceTable rows={gov?.perUser ?? []} />
              )}
            </ChartCard>
          </>
        )}

        <div className="col-span-12">
          <WhatsCollectedLink />
        </div>

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// Per-user governance table (sortable)
// ---------------------------------------------------------------------------

type GovRow = GovernanceResponse['perUser'][number];
type GovSortKey = 'name' | 'autoApprovedShare' | 'rejects' | 'aborts' | 'modeChanges';

const GOV_SORTERS: Record<GovSortKey, (u: GovRow) => number | string> = {
  name: (u) => u.name.toLowerCase(),
  autoApprovedShare: (u) => u.autoApprovedShare ?? -1,
  rejects: (u) => u.rejects,
  aborts: (u) => u.aborts,
  modeChanges: (u) => u.modeChanges,
};

function GovTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: GovSortKey;
  sort: { key: GovSortKey; dir: 1 | -1 };
  onSort: (k: GovSortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === sortKey;
  return (
    <th
      className={cn(
        'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
        align === 'right' && 'text-right',
      )}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-0.5 uppercase tracking-wider transition-colors hover:text-fg',
          active && 'text-fg',
        )}
      >
        {label}
        {active && (sort.dir === -1 ? <ArrowDown size={10} /> : <ArrowUp size={10} />)}
      </button>
    </th>
  );
}

function PerUserGovernanceTable({ rows }: { rows: GovernanceResponse['perUser'] }) {
  const [sort, setSort] = useState<{ key: GovSortKey; dir: 1 | -1 }>({
    key: 'autoApprovedShare',
    dir: -1,
  });

  const onSort = (key: GovSortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === -1 ? 1 : -1 } : { key, dir: key === 'name' ? 1 : -1 },
    );

  const sorted = useMemo(() => {
    const sorter = GOV_SORTERS[sort.key];
    return [...rows].sort((a, b) => {
      const av = sorter(a);
      const bv = sorter(b);
      const cmp =
        typeof av === 'string' || typeof bv === 'string'
          ? String(av).localeCompare(String(bv))
          : (av as number) - (bv as number);
      return cmp * sort.dir;
    });
  }, [rows, sort]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <GovTh label="Member" sortKey="name" sort={sort} onSort={onSort} />
            <GovTh label="Auto-approved" sortKey="autoApprovedShare" sort={sort} onSort={onSort} align="right" />
            <GovTh label="Rejects" sortKey="rejects" sort={sort} onSort={onSort} align="right" />
            <GovTh label="Aborts" sortKey="aborts" sort={sort} onSort={onSort} align="right" />
            <GovTh label="Mode changes" sortKey="modeChanges" sort={sort} onSort={onSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr key={u.userId} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="px-2.5 py-2">
                <Link
                  to={`/user/${encodeURIComponent(u.email ?? String(u.userId))}`}
                  className="group inline-flex items-center gap-2.5"
                >
                  <Avatar name={u.name} email={u.email} size={26} />
                  <span className="truncate text-[13px] font-medium group-hover:text-accent group-hover:underline">
                    {u.name}
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px] font-medium">
                {fmtPct(u.autoApprovedShare)}
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-right text-xs',
                  u.rejects > 0 ? 'font-medium text-risk' : 'text-muted',
                )}
              >
                {fmtNumber(u.rejects)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.aborts)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.modeChanges)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
