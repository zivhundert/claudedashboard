import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type {
  AgentUsageRow,
  EcosystemResponse,
  SkillSource,
  SkillUsageRow,
  SkillsResponse,
  ToolUsageRow,
  UserSkillRow,
} from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useEcosystem, useOverview, useSkillCatalog, useSkills } from '@/lib/queries';
import { useChartTheme, asTipArray } from '@/lib/chartTheme';
import { fmtCost, fmtNumber, fmtPct, fmtTokens, relativeIso } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { EChart, type EChartsOption } from '@/components/EChart';
import type { ChartRef } from '@/components/TrendChart';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton, TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Avatar } from '@/components/Avatar';
import { BreakdownDrawer, DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';
import { Segmented, Tip } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EntityName } from '@/components/EntityName';
import { useEntityStore } from '@/state/entity';
import { ModelMixChart, PluginsList, ToolUsageList, VersionDriftBars } from '@/components/EcosystemCards';
import {
  SkillSourceBadge,
  useSkillCatalogIndex,
  type SkillCatalogIndex,
} from '@/components/SkillCatalog';

/** Telemetry replaces non-allowlisted skill names with these placeholders. */
const REDACTED_NOTE = 'name redacted by telemetry settings';
const isRedactedSkill = (name: string) => name === 'custom_skill' || name === 'third-party';

/** Skill names come verbatim from OTEL attributes — escape before tooltip-HTML interpolation. */
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const userPath = (u: Pick<UserSkillRow, 'userId' | 'email'>) =>
  `/user/${encodeURIComponent(u.email ?? String(u.userId))}`;

export default function OrgSkills() {
  const { from, to, teamId } = useRangeParams();
  const skillsQ = useSkills({ from, to, teamId });
  const ecosystemQ = useEcosystem({ from, to, teamId });
  // what each skill IS — range-independent, so it rides its own cached query
  const catalogQ = useSkillCatalog();
  // org active users for the "share of actives" KPI footer (cached from Overview)
  const overviewQ = useOverview({ from, to, teamId });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const skills = skillsQ.data;
  const noData = !!skills && !skills.hasData;
  const eco = ecosystemQ.data;
  const orgActiveUsers = overviewQ.data?.kpis.activeUsers ?? null;
  const catalog = useSkillCatalogIndex(catalogQ.data?.entries);

  return (
    <ChartPage pageId="skills">
      <div className="grid grid-cols-12 gap-4">
        {skillsQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={skillsQ.error} onRetry={() => void skillsQ.refetch()} />
          </div>
        ) : (
          <>
            {noData && (
              <TelemetrySetupCard blurb="This view is powered by Claude Code’s OpenTelemetry events — skills, subagents, and the full tool picture the Admin API doesn’t report." />
            )}

            <KpiRow skills={skills} loading={skillsQ.isLoading} noData={noData} orgActiveUsers={orgActiveUsers} />

            <TopSkillsCard
              rows={skills?.skills ?? []}
              isLoading={skillsQ.isLoading}
              noData={noData}
              catalog={catalog}
              onRetry={() => void skillsQ.refetch()}
            />

            <ChartCard
              title="How skills start"
              chartId="skill-triggers"
              metricKey="skillTriggers"
              subtitle="Typed /command vs proactive vs nested, top 8 skills"
              className="col-span-12 lg:col-span-5"
              isLoading={skillsQ.isLoading}
              isEmpty={noData || (!!skills && skills.skills.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : undefined}
            >
              {(ref) => <SkillTriggersChart instanceRef={ref} rows={skills?.skills ?? []} />}
            </ChartCard>

            <ChartCard
              title="Subagents"
              chartId="subagents"
              metricKey="agentsUsage"
              subtitle="Delegated runs by subagent type"
              className="col-span-12 lg:col-span-7"
              isLoading={skillsQ.isLoading}
              isEmpty={noData || (!!skills && skills.agents.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No subagent runs in this range'}
            >
              {(ref) => (
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="shrink-0 md:w-60">
                    <AgentsDonut instanceRef={ref} rows={skills?.agents ?? []} />
                  </div>
                  <div className="min-w-0 flex-1 overflow-x-auto">
                    <AgentsTable rows={skills?.agents ?? []} onDrill={setDrill} />
                  </div>
                </div>
              )}
            </ChartCard>

            <ChartCard
              title="Tool usage"
              chartId="tool-usage"
              metricKey="toolsUsage"
              subtitle="All tools from telemetry, top 15 by uses"
              className="col-span-12 lg:col-span-5"
              noExport
              isLoading={skillsQ.isLoading}
              isEmpty={noData || (!!skills && skills.tools.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No tool events in this range'}
            >
              <ToolUsageList rows={skills?.tools ?? []} onDrill={setDrill} />
            </ChartCard>

            <ChartCard
              title="Skill power users"
              chartId="skill-power-users"
              metricKey="skillsUsage"
              infoExtra="Per-person skill and subagent activity from telemetry. Only people whose machines ship OpenTelemetry events appear here."
              className="col-span-12"
              noExport
              isEmpty={noData || (!!skills && skills.users.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No per-user telemetry in this range'}
            >
              {skillsQ.isLoading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : (
                <PowerUsersTable rows={skills?.users ?? []} catalog={catalog} />
              )}
            </ChartCard>

            {eco?.hasData && <EcosystemSection eco={eco} onDrill={setDrill} />}

            {skills && (
              <div className="col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>
                  {fmtNumber(skills.ingest.eventsIngested)} events ingested · last event{' '}
                  {relativeIso(skills.ingest.lastEventAt)}
                </span>
                <CatalogCoverage
                  rows={skills.skills}
                  catalog={catalog}
                  lastUpdatedAt={catalogQ.data?.lastUpdatedAt ?? null}
                />
                <WhatsCollectedLink />
              </div>
            )}
          </>
        )}

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

function KpiRow({
  skills,
  loading,
  noData,
  orgActiveUsers,
}: {
  skills: SkillsResponse | undefined;
  loading: boolean;
  noData: boolean;
  orgActiveUsers: number | null;
}) {
  if (loading || !skills) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const { totals } = skills;
  const activeShare =
    orgActiveUsers !== null && orgActiveUsers > 0 && !noData
      ? `${fmtPct(totals.activeSkillUsers / orgActiveUsers)} of ${fmtNumber(orgActiveUsers)} org active users`
      : 'people who invoked ≥ 1 skill';
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Skill invocations"
        {...(noData ? { display: '—' } : { value: totals.skillInvocations })}
        metricKey="skillsUsage"
        footer={noData ? 'Waiting for telemetry' : `${fmtNumber(totals.distinctSkills)} distinct skills`}
      />
      <StatCard
        label="Active skill users"
        {...(noData ? { display: '—' } : { value: totals.activeSkillUsers })}
        metricKey="skillsUsage"
        footer={noData ? 'Waiting for telemetry' : activeShare}
      />
      <StatCard
        label="Subagent runs"
        {...(noData ? { display: '—' } : { value: totals.agentInvocations })}
        metricKey="agentsUsage"
        footer={
          noData
            ? 'Waiting for telemetry'
            : `${fmtNumber(skills.agents.length)} subagent type${skills.agents.length === 1 ? '' : 's'}`
        }
      />
      <StatCard
        label="Skill cost"
        {...(noData ? { display: '—' } : { value: totals.skillCostCents, format: fmtCost })}
        metricKey="skillsUsage"
        footer={noData ? 'Waiting for telemetry' : `+ agent cost ${fmtCost(totals.agentCostCents)}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Catalog coverage footer
// ---------------------------------------------------------------------------

/**
 * How much of what ran is actually described. A skill with no catalog entry is
 * a gap in the scan, not an unknown skill — say so, and say how to close it.
 */
function CatalogCoverage({
  rows,
  catalog,
  lastUpdatedAt,
}: {
  rows: SkillUsageRow[];
  catalog: SkillCatalogIndex;
  lastUpdatedAt: string | null;
}) {
  const { described, describable, bySource } = useMemo(() => {
    // redacted buckets can never match an entry, so they are not a coverage miss
    const real = rows.filter((r) => !isRedactedSkill(r.skillName));
    const entries = real.map((r) => catalog.get(r.skillName)).filter((e) => e !== undefined);
    const tally = new Map<SkillSource, number>();
    for (const e of entries) tally.set(e.source, (tally.get(e.source) ?? 0) + 1);
    return { described: entries.length, describable: real.length, bySource: [...tally.entries()] };
  }, [rows, catalog]);

  if (catalog.size === 0) {
    return (
      <span>
        No skill catalog — run <span className="font-mono text-fg">pnpm skills:scan</span> to add
        descriptions
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span>
        {fmtNumber(described)} of {fmtNumber(describable)} skills described
      </span>
      {bySource.map(([source, n]) => (
        <SkillSourceBadge key={source} source={source} className="opacity-80">
          {n}
        </SkillSourceBadge>
      ))}
      <span>· scanned {relativeIso(lastUpdatedAt)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Top skills (toggle invocations / cost)
// ---------------------------------------------------------------------------

type SkillMode = 'invocations' | 'cost';

function TopSkillsCard({
  rows,
  isLoading,
  noData,
  catalog,
  onRetry,
}: {
  rows: SkillUsageRow[];
  isLoading: boolean;
  noData: boolean;
  catalog: SkillCatalogIndex;
  onRetry: () => void;
}) {
  const [mode, setMode] = useState<SkillMode>('invocations');
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  // the catalog description is searchable too — "what handles Jira?" is a more
  // useful question than "which skill is spelled like this?"
  const filtered = useMemo(
    () =>
      q
        ? rows.filter(
            (r) =>
              r.skillName.toLowerCase().includes(q) ||
              (catalog.get(r.skillName)?.description ?? '').toLowerCase().includes(q),
          )
        : rows,
    [rows, q, catalog],
  );
  return (
    <ChartCard
      title="Skills"
      chartId="top-skills"
      metricKey="skillsUsage"
      subtitle="All skills in range — click a bar for the skill’s details"
      actions={
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter skills…"
            aria-label="Filter skills by name or description"
            className="w-32 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
          <Segmented
            size="xs"
            options={[
              { id: 'invocations' as const, label: 'Invocations' },
              { id: 'cost' as const, label: 'Cost' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      }
      className="col-span-12 lg:col-span-7"
      isLoading={isLoading}
      onRetry={onRetry}
      isEmpty={noData || filtered.length === 0}
      emptyText={
        noData
          ? 'Waiting for telemetry events'
          : q && rows.length > 0
            ? 'No skills match the filter'
            : 'No skill invocations in this range'
      }
    >
      {(ref) => (
        <TopSkillsChart
          instanceRef={ref}
          rows={filtered}
          mode={mode}
          catalog={catalog}
        />
      )}
    </ChartCard>
  );
}

function TopSkillsChart({
  instanceRef,
  rows,
  mode,
  catalog,
}: {
  instanceRef: ChartRef;
  rows: SkillUsageRow[];
  mode: SkillMode;
  catalog: SkillCatalogIndex;
}) {
  const t = useChartTheme();
  const openEntity = useEntityStore((s) => s.open);
  const sorted = useMemo(() => {
    const metric = (r: SkillUsageRow) => (mode === 'cost' ? r.costCents : r.invocations);
    // ascending so the biggest skill renders at the top of the category axis
    return [...rows].sort((a, b) => metric(a) - metric(b));
  }, [rows, mode]);
  const option = useMemo<EChartsOption>(() => {
    const metric = (r: SkillUsageRow) => (mode === 'cost' ? r.costCents : r.invocations);
    const top = sorted;
    const fmtVal = mode === 'cost' ? fmtCost : fmtNumber;
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          const row = top[p.dataIndex ?? -1];
          if (!row) return '';
          const note = isRedactedSkill(row.skillName)
            ? `<div style="margin-top:2px;font-size:10.5px;opacity:.65">${REDACTED_NOTE}</div>`
            : '';
          // catalog text is author-written frontmatter — escaped like the name
          const entry = catalog.get(row.skillName);
          const blurb = entry?.description
            ? `<div style="margin-top:3px;max-width:320px;white-space:normal;font-size:10.5px;opacity:.8">${escapeHtml(
                entry.description.length > 160 ? `${entry.description.slice(0, 160)}…` : entry.description,
              )}</div>`
            : '';
          return (
            `${p.marker ?? ''}<b>${escapeHtml(row.skillName)}</b>` +
            `<div style="margin-top:3px">Invocations: <b>${fmtNumber(row.invocations)}</b><br/>` +
            `Users: ${fmtNumber(row.users)}<br/>` +
            `Cost: ${fmtCost(row.costCents)}</div>${blurb}${note}`
          );
        },
      },
      grid: { left: 8, right: 52, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtVal(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      yAxis: {
        type: 'category',
        data: top.map((r) => r.skillName),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          color: (name?: string | number) =>
            typeof name === 'string' && isRedactedSkill(name) ? t.muted : t.fg,
        },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 16,
          cursor: 'pointer',
          label: {
            show: true,
            position: 'right',
            color: t.muted,
            fontSize: 10.5,
            formatter: (p: { value?: unknown }) => fmtVal(typeof p.value === 'number' ? p.value : 0),
          },
          data: top.map((r) => ({
            value: metric(r),
            itemStyle: {
              color: isRedactedSkill(r.skillName) ? t.muted : t.accent,
              opacity: isRedactedSkill(r.skillName) ? 0.55 : 0.9,
              borderRadius: [0, 3, 3, 0],
            },
          })),
        },
      ],
    };
  }, [sorted, mode, t, catalog]);
  // every skill gets a row, so the card grows with the list instead of clipping it
  const height = Math.max(320, rows.length * 26 + 40);
  return (
    <div style={{ height }}>
      <EChart
        option={option}
        instanceRef={instanceRef}
        className="h-full"
        onClickPoint={(p) => {
          const row = typeof p.dataIndex === 'number' ? sorted[p.dataIndex] : undefined;
          if (row) openEntity('skill', row.skillName);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// How skills start (trigger split)
// ---------------------------------------------------------------------------

function SkillTriggersChart({ instanceRef, rows }: { instanceRef: ChartRef; rows: SkillUsageRow[] }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    const top = [...rows]
      .sort((a, b) => b.invocations - a.invocations)
      .slice(0, 8)
      .reverse();
    const triggers = [
      { name: 'Typed /command', color: t.accent, value: (r: SkillUsageRow) => r.userSlash },
      { name: 'Proactive', color: t.accent2, value: (r: SkillUsageRow) => r.proactive },
      { name: 'Nested', color: t.palette[6] ?? t.good, value: (r: SkillUsageRow) => r.nested },
    ];
    return {
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        trigger: 'axis',
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const items = asTipArray(raw);
          const name = items[0]?.name ?? '';
          const note = isRedactedSkill(name)
            ? `<div style="font-size:10.5px;opacity:.65">${REDACTED_NOTE}</div>`
            : '';
          const lines = items
            .filter((p) => typeof p.value === 'number' && p.value > 0)
            .map((p) => `${p.marker ?? ''}${p.seriesName ?? ''}: <b>${fmtNumber(p.value as number)}</b>`);
          return `<div style="font-size:11px"><b>${escapeHtml(name)}</b></div>${note}${lines.join('<br/>')}`;
        },
      },
      legend: { top: 0, right: 0, textStyle: { color: t.muted, fontSize: 10.5 }, icon: 'circle', itemWidth: 8 },
      grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: t.muted, fontSize: 10.5, formatter: (v: number) => fmtNumber(v) },
        splitLine: { lineStyle: { color: t.border, opacity: 0.5 } },
      },
      yAxis: {
        type: 'category',
        data: top.map((r) => r.skillName),
        axisLine: { lineStyle: { color: t.border } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          color: (name?: string | number) =>
            typeof name === 'string' && isRedactedSkill(name) ? t.muted : t.fg,
        },
      },
      series: triggers.map((tr) => ({
        name: tr.name,
        type: 'bar' as const,
        stack: 'trigger',
        barMaxWidth: 14,
        emphasis: { focus: 'series' as const },
        itemStyle: { color: tr.color, opacity: 0.9 },
        data: top.map((r) => tr.value(r)),
      })),
    };
  }, [rows, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-80" />;
}

// ---------------------------------------------------------------------------
// Subagents: donut + compact table
// ---------------------------------------------------------------------------

function AgentsDonut({ instanceRef, rows }: { instanceRef: ChartRef; rows: AgentUsageRow[] }) {
  const t = useChartTheme();
  const option = useMemo<EChartsOption>(() => {
    return {
      color: t.palette,
      textStyle: { color: t.fg, fontFamily: 'inherit' },
      tooltip: {
        backgroundColor: t.card,
        borderColor: t.border,
        textStyle: { color: t.fg, fontSize: 12 },
        formatter: (raw: unknown) => {
          const p = asTipArray(raw)[0] ?? {};
          return `${p.marker ?? ''}<b>${p.name ?? ''}</b>: ${fmtNumber(typeof p.value === 'number' ? p.value : 0)} runs (${p.percent ?? 0}%)`;
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '80%'],
          center: ['50%', '50%'],
          itemStyle: { borderColor: t.card, borderWidth: 2 },
          label: { show: false },
          data: rows.map((r) => ({ name: r.subagentType, value: r.invocations })),
        },
      ],
    };
  }, [rows, t]);
  return <EChart option={option} instanceRef={instanceRef} className="h-52" />;
}

function AgentsTable({
  rows,
  onDrill,
}: {
  rows: AgentUsageRow[];
  onDrill: (t: BreakdownTarget) => void;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.invocations - a.invocations), [rows]);
  return (
    <table className="w-full min-w-[380px] border-collapse text-sm">
      <thead>
        <tr className="border-b border-border">
          {['Type', 'Runs', 'Users', 'Success', 'Cost'].map((h, i) => (
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
        {sorted.map((a) => {
          const lowSuccess = a.successRate !== null && a.successRate < 0.7;
          return (
            <tr key={a.subagentType} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="max-w-44 px-2.5 py-1.5 text-[12.5px] font-medium">
                <EntityName kind="agent" name={a.subagentType} />
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-[12.5px]">
                {fmtNumber(a.invocations)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                <DrillCount
                  value={a.users}
                  onClick={() =>
                    onDrill({
                      dimension: 'agent',
                      entity: a.subagentType,
                      title: `Subagent · ${a.subagentType}`,
                    })
                  }
                />
              </td>
              <td
                className={cn(
                  'whitespace-nowrap px-2.5 py-1.5 text-right text-xs',
                  lowSuccess ? 'font-medium text-risk' : 'text-muted',
                )}
              >
                {fmtPct(a.successRate)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                {fmtCost(a.costCents)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Skill power users table
// ---------------------------------------------------------------------------

type UserSortKey = 'name' | 'skillInvocations' | 'distinctSkills' | 'agentInvocations' | 'topSkill';

const USER_SORTERS: Record<UserSortKey, (u: UserSkillRow) => number | string> = {
  name: (u) => u.name.toLowerCase(),
  skillInvocations: (u) => u.skillInvocations,
  distinctSkills: (u) => u.distinctSkills,
  agentInvocations: (u) => u.agentInvocations,
  topSkill: (u) => (u.topSkill ?? '').toLowerCase(),
};

function UserTh({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: UserSortKey;
  sort: { key: UserSortKey; dir: 1 | -1 };
  onSort: (k: UserSortKey) => void;
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

function TopSkillChip({ skill, catalog }: { skill: string | null; catalog: SkillCatalogIndex }) {
  if (!skill) return <span className="text-xs text-muted">—</span>;
  const chip = (
    <span
      className={cn(
        'inline-flex max-w-48 truncate rounded-full border px-2 py-0.5 font-mono text-[10.5px]',
        isRedactedSkill(skill) ? 'border-border bg-fg/5 text-muted' : 'border-accent/30 bg-accent/10 text-accent',
      )}
    >
      {skill}
    </span>
  );
  if (isRedactedSkill(skill)) return <Tip content={REDACTED_NOTE}>{chip}</Tip>;
  const entry = catalog.get(skill);
  // a bare name in a table says nothing; the catalog description says what it does
  return entry?.description ? <Tip content={entry.description}>{chip}</Tip> : chip;
}

function PowerUsersTable({ rows, catalog }: { rows: UserSkillRow[]; catalog: SkillCatalogIndex }) {
  const [sort, setSort] = useState<{ key: UserSortKey; dir: 1 | -1 }>({ key: 'skillInvocations', dir: -1 });

  const onSort = (key: UserSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === -1 ? 1 : -1 }
        : { key, dir: key === 'name' || key === 'topSkill' ? 1 : -1 },
    );

  const sorted = useMemo(() => {
    const sorter = USER_SORTERS[sort.key];
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
            <UserTh label="Member" sortKey="name" sort={sort} onSort={onSort} />
            <UserTh label="Skill invocations" sortKey="skillInvocations" sort={sort} onSort={onSort} align="right" />
            <UserTh label="Distinct skills" sortKey="distinctSkills" sort={sort} onSort={onSort} align="right" />
            <UserTh label="Subagent runs" sortKey="agentInvocations" sort={sort} onSort={onSort} align="right" />
            <UserTh label="Top skill" sortKey="topSkill" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr key={u.userId} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="px-2.5 py-2">
                <Link to={userPath(u)} className="group inline-flex items-center gap-2.5">
                  <Avatar name={u.name} email={u.email} size={26} />
                  <span className="truncate text-[13px] font-medium group-hover:text-accent group-hover:underline">
                    {u.name}
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-[13px] font-medium">
                {fmtNumber(u.skillInvocations)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.distinctSkills)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.agentInvocations)}
              </td>
              <td className="px-2.5 py-2">
                <TopSkillChip skill={u.topSkill} catalog={catalog} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ecosystem (telemetry metrics pack): MCP servers / plugins / versions / mix
// ---------------------------------------------------------------------------

function EcosystemSection({
  eco,
  onDrill,
}: {
  eco: EcosystemResponse;
  onDrill: (t: BreakdownTarget) => void;
}) {
  return (
    <>
      <div className="col-span-12 mt-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Ecosystem
      </div>

      <ChartCard
        title="MCP servers"
        chartId="mcp-servers"
        metricKey="mcpUsage"
        subtitle="Connected tools used through Claude Code"
        className="col-span-12 lg:col-span-7"
        noExport
        isEmpty={eco.mcpServers.length === 0}
        emptyText="No MCP activity in this range"
      >
        <McpServersTable rows={eco.mcpServers} onDrill={onDrill} />
      </ChartCard>

      <ChartCard
        title="Plugins"
        chartId="plugins"
        metricKey="pluginAdoption"
        subtitle="Installed and actually loaded"
        className="col-span-12 lg:col-span-5"
        noExport
        isEmpty={eco.plugins.length === 0}
        emptyText="No plugin activity in this range"
      >
        <PluginsList rows={eco.plugins} onDrill={onDrill} />
      </ChartCard>

      <ChartCard
        title="Version drift"
        chartId="version-drift"
        metricKey="versionDrift"
        subtitle="Claude Code versions in the field — latest highlighted"
        className="col-span-12 lg:col-span-5"
        noExport
        isEmpty={eco.versions.length === 0}
        emptyText="No version telemetry in this range"
      >
        <VersionDriftBars rows={eco.versions} onDrill={onDrill} />
      </ChartCard>

      <ChartCard
        title="Model / speed / effort mix"
        chartId="model-speed-effort-mix"
        metricKey="modelSpeedMix"
        subtitle="Tokens by model, stacked by speed × effort"
        className="col-span-12 lg:col-span-7"
        isEmpty={eco.modelMix.length === 0}
        emptyText="No model-mix telemetry in this range"
      >
        {(ref) => <ModelMixChart instanceRef={ref} rows={eco.modelMix} />}
      </ChartCard>
    </>
  );
}

function McpServersTable({
  rows,
  onDrill,
}: {
  rows: EcosystemResponse['mcpServers'];
  onDrill: (t: BreakdownTarget) => void;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.toolCalls - a.toolCalls), [rows]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Server', 'Calls', 'Failures', 'Tokens', 'Cost', 'Connections', 'Users'].map((h, i) => (
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
                <td className="max-w-44 px-2.5 py-1.5 font-mono text-[12px] font-medium">
                  <EntityName kind="mcp" name={s.serverName} />
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-[12.5px]">
                  {fmtNumber(s.toolCalls)}
                </td>
                <td
                  className={cn(
                    'whitespace-nowrap px-2.5 py-1.5 text-right text-xs',
                    s.toolFailures === 0 ? 'text-muted' : failRate > 0.1 ? 'font-medium text-risk' : 'font-medium text-warn',
                  )}
                >
                  {fmtNumber(s.toolFailures)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                  {fmtTokens(s.tokens)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                  {fmtCost(s.costCents)}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs">
                  <span className="text-muted">{fmtNumber(s.connections)}</span>
                  {s.connectionFailures > 0 && (
                    <span className="ml-1 font-medium text-risk">· {fmtNumber(s.connectionFailures)} failed</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted">
                  <DrillCount
                    value={s.users}
                    onClick={() =>
                      onDrill({
                        dimension: 'mcp',
                        entity: s.serverName,
                        title: `MCP server · ${s.serverName}`,
                      })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
