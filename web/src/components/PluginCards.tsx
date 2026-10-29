import { Fragment, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { PluginsResponse, PluginUsageRow } from '@dash/shared';
import { fmtCost, fmtNumber } from '@/lib/format';
import { ChartCard } from '@/components/ChartCard';
import { StatCard } from '@/components/StatCard';
import { StatSkeleton } from '@/components/Skeleton';
import { DrillCount, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { Segmented } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EntityName } from '@/components/EntityName';

type Drill = ((t: BreakdownTarget) => void) | undefined;
type RankMode = 'people' | 'calls';
type RankedPlugin = PluginUsageRow & { rank: number };

/** 'plugin:skill' → 'skill'; names without the plugin prefix stay as they are. */
function skillLabel(skillName: string, pluginName: string): string {
  return skillName.startsWith(`${pluginName}:`) ? skillName.slice(pluginName.length + 1) : skillName;
}

/** 'plugin_<plugin>_<server>' / 'plugin:<plugin>:<server>' → '<server>'. */
function mcpLabel(serverName: string, pluginName: string): string {
  for (const prefix of [`plugin_${pluginName}_`, `plugin:${pluginName}:`]) {
    if (serverName.startsWith(prefix)) return serverName.slice(prefix.length);
  }
  return serverName;
}

const plural = (n: number, one: string, many: string) => `${fmtNumber(n)} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// KPI row
// ---------------------------------------------------------------------------

export function PluginKpis({
  data,
  loading,
  noData,
}: {
  data: PluginsResponse | undefined;
  loading: boolean;
  noData: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>
    );
  }
  const used = data.plugins.filter((p) => p.users > 0);
  const calls = used.reduce((s, p) => s + p.calls, 0);
  const runs = used.reduce((s, p) => s + p.invocations, 0);
  const mcpCalls = used.reduce((s, p) => s + p.mcpCalls, 0);
  const agentRuns = used.reduce((s, p) => s + p.agentRuns, 0);
  const top = used[0];
  return (
    <div className="col-span-12 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Plugins in use"
        {...(noData ? { display: '—' } : { value: used.length })}
        metricKey="pluginUsage"
        footer={noData ? 'Waiting for telemetry' : `of ${fmtNumber(data.plugins.length)} loaded or used`}
      />
      <StatCard
        label="People using plugins"
        {...(noData ? { display: '—' } : { value: data.users })}
        metricKey="pluginUsage"
        footer={noData ? 'Waiting for telemetry' : 'ran a plugin skill, MCP tool or agent'}
      />
      <StatCard
        label="Plugin calls"
        {...(noData ? { display: '—' } : { value: calls })}
        metricKey="pluginUsage"
        footer={
          noData
            ? 'Waiting for telemetry'
            : `${fmtNumber(runs)} skill runs · ${fmtNumber(mcpCalls)} MCP · ${fmtNumber(agentRuns)} agent`
        }
      />
      <StatCard
        label="Top plugin"
        display={noData || !top ? '—' : top.pluginName}
        metricKey="pluginUsage"
        footer={noData || !top ? 'Waiting for telemetry' : `${plural(top.users, 'person', 'people')} · ${plural(top.calls, 'call', 'calls')}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking — one row per plugin, expandable into its skills
// ---------------------------------------------------------------------------

export function PluginRankingCard({
  rows,
  isLoading,
  noData,
  onDrill,
  onRetry,
}: {
  rows: PluginUsageRow[];
  isLoading: boolean;
  noData: boolean;
  onDrill?: Drill;
  onRetry?: () => void;
}) {
  const [mode, setMode] = useState<RankMode>('people');
  const [filter, setFilter] = useState('');
  const [showUnused, setShowUnused] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());

  const q = filter.trim().toLowerCase();
  const unused = rows.filter((r) => r.users === 0).length;
  // rank and bar scale come from the whole list, so filtering never renumbers it
  const { visible, max } = useMemo(() => {
    const metric = (r: PluginUsageRow) => (mode === 'calls' ? r.calls : r.users);
    const ranked: RankedPlugin[] = [...rows]
      .sort((a, b) => metric(b) - metric(a) || b.users - a.users || b.calls - a.calls || b.loads - a.loads)
      .map((r, i) => ({ ...r, rank: i + 1 }));
    const matches = (r: PluginUsageRow) =>
      r.pluginName.toLowerCase().includes(q) ||
      r.skills.some((s) => s.skillName.toLowerCase().includes(q)) ||
      r.mcpServers.some((m) => m.serverName.toLowerCase().includes(q)) ||
      r.agents.some((g) => g.agentType.toLowerCase().includes(q));
    return {
      visible: ranked.filter((r) => showUnused || r.users > 0).filter((r) => !q || matches(r)),
      max: ranked.reduce((m, r) => Math.max(m, metric(r)), 0),
    };
  }, [rows, mode, q, showUnused]);

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <ChartCard
      title="Plugin ranking"
      chartId="plugin-ranking"
      metricKey="pluginUsage"
      subtitle="Plugins ranked by the people using them — expand a plugin for its skills, MCP servers and agents"
      infoExtra="People = anyone who ran one of the plugin’s skills, called one of its MCP tools or ran one of its agents. Calls = skill runs + MCP tool calls + agent runs. A skill or agent counts toward a plugin when telemetry names the plugin, or when its 'plugin:' prefix matches a plugin Claude Code reported loading; plugin MCP servers are named 'plugin_<plugin>_<server>'. Skill cost is the API cost attributed to its skills. Loads are sessions that loaded the plugin, used or not. Unused plugins are hidden by default."
      actions={
        <div className="flex items-center gap-2">
          {unused > 0 && (
            <button
              type="button"
              onClick={() => setShowUnused((v) => !v)}
              aria-pressed={showUnused}
              className="rounded-md border border-border bg-transparent px-2 py-1 text-xs text-muted transition-colors hover:border-accent hover:text-fg"
            >
              {showUnused ? 'Hide unused' : `Show ${fmtNumber(unused)} unused`}
            </button>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter plugins…"
            aria-label="Filter plugins by plugin, skill, MCP server or agent name"
            className="w-32 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
          <Segmented
            size="xs"
            options={[
              { id: 'people' as const, label: 'People' },
              { id: 'calls' as const, label: 'Calls' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      }
      className="col-span-12"
      noExport
      isLoading={isLoading}
      {...(onRetry ? { onRetry } : {})}
      isEmpty={noData || visible.length === 0}
      emptyText={
        noData
          ? 'Waiting for telemetry events'
          : q && rows.length > 0
            ? 'No plugins match the filter'
            : rows.length > 0
              ? 'No plugin was used in this range'
              : 'No plugin activity in this range'
      }
    >
      <RankingTable
        rows={visible}
        max={max}
        mode={mode}
        open={open}
        onToggle={toggle}
        onDrill={onDrill}
        filter={q}
      />
    </ChartCard>
  );
}

function RankingTable({
  rows,
  max,
  mode,
  open,
  onToggle,
  onDrill,
  filter,
}: {
  rows: RankedPlugin[];
  /** whole-list top value, so bars don't change under the filter */
  max: number;
  mode: RankMode;
  open: Set<string>;
  onToggle: (name: string) => void;
  onDrill: Drill;
  filter: string;
}) {
  const headers = ['#', 'Plugin', 'People', 'Calls', 'Skill runs', 'MCP calls', 'Agent runs', 'Skill cost', 'Loads'];
  const num = 'whitespace-nowrap px-2.5 py-1.5 text-right text-xs text-muted';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={h}
                className={cn(
                  'whitespace-nowrap px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i === 0 || i === 1 ? 'text-left' : 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isOpen = open.has(p.pluginName) || (!!filter && !p.pluginName.toLowerCase().includes(filter));
            const value = mode === 'calls' ? p.calls : p.users;
            return (
              <Fragment key={p.pluginName}>
                <tr
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-fg/[0.025]"
                  onClick={() => onToggle(p.pluginName)}
                >
                  <td className="w-8 px-2.5 py-1.5 text-xs text-muted">{p.rank}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(p.pluginName);
                        }}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${p.pluginName}`}
                        className="shrink-0 rounded text-muted transition-colors hover:text-fg"
                      >
                        <ChevronRight
                          size={14}
                          className={cn('transition-transform', isOpen && 'rotate-90')}
                          aria-hidden
                        />
                      </button>
                      <span className="w-44 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <EntityName kind="plugin" name={p.pluginName} className="font-mono text-[12px] font-medium" />
                      </span>
                      <span className="h-[6px] min-w-16 flex-1 overflow-hidden rounded-full bg-fg/10">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${max > 0 && value > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%` }}
                        />
                      </span>
                    </span>
                  </td>
                  <td className={cn(num, mode === 'people' && 'text-[12.5px] font-medium text-fg')}>{fmtNumber(p.users)}</td>
                  <td className={cn(num, mode === 'calls' && 'text-[12.5px] font-medium text-fg')}>{fmtNumber(p.calls)}</td>
                  <td className={num}>{p.invocations ? fmtNumber(p.invocations) : '—'}</td>
                  <td className={num}>{p.mcpCalls ? fmtNumber(p.mcpCalls) : '—'}</td>
                  <td className={num}>{p.agentRuns ? fmtNumber(p.agentRuns) : '—'}</td>
                  <td className={num}>{p.invocations ? fmtCost(p.costCents) : '—'}</td>
                  <td className={num}>{fmtNumber(p.loads)}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/60 bg-fg/[0.02]">
                    <td />
                    <td colSpan={headers.length - 1} className="px-2.5 pb-2.5 pt-1">
                      <PluginParts plugin={p} onDrill={onDrill} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface Part {
  key: string;
  label: string;
  kind: 'skill' | 'mcp' | 'agent';
  count: number;
  users: number;
}

function PluginParts({ plugin, onDrill }: { plugin: PluginUsageRow; onDrill: Drill }) {
  if (plugin.users === 0) {
    return (
      <p className="py-1 pl-6 text-xs text-muted">
        Loaded {fmtNumber(plugin.loads)} times by {fmtNumber(plugin.loadUsers)} people — none of its skills, MCP tools or
        agents were used in this range.
      </p>
    );
  }
  const groups: Array<{ title: string; noun: [string, string]; unit: [string, string]; parts: Part[] }> = [
    {
      title: 'Skills',
      noun: ['skill', 'skills'],
      unit: ['run', 'runs'],
      parts: plugin.skills.map((s) => ({
        key: s.skillName,
        label: skillLabel(s.skillName, plugin.pluginName),
        kind: 'skill' as const,
        count: s.invocations,
        users: s.users,
      })),
    },
    {
      title: 'MCP servers',
      noun: ['server', 'servers'],
      unit: ['call', 'calls'],
      parts: plugin.mcpServers.map((m) => ({
        key: m.serverName,
        label: mcpLabel(m.serverName, plugin.pluginName),
        kind: 'mcp' as const,
        count: m.calls,
        users: m.users,
      })),
    },
    {
      title: 'Agents',
      noun: ['agent', 'agents'],
      unit: ['run', 'runs'],
      parts: plugin.agents.map((g) => ({
        key: g.agentType,
        label: skillLabel(g.agentType, plugin.pluginName),
        kind: 'agent' as const,
        count: g.runs,
        users: g.users,
      })),
    },
  ];
  const drillTitle = { skill: 'Skill', mcp: 'MCP server', agent: 'Agent' } as const;
  return (
    <div className="space-y-2.5 py-1 pl-6">
      {groups
        .filter((g) => g.parts.length > 0)
        .map((g) => {
          const max = g.parts.reduce((m, r) => Math.max(m, r.count), 0);
          return (
            <div key={g.title}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {g.title} · {plural(g.parts.length, ...g.noun)}
              </p>
              <ul className="space-y-1.5">
                {g.parts.map((part) => (
                  <li key={part.key} className="flex items-center gap-2.5">
                    <EntityName
                      kind={part.kind}
                      name={part.key}
                      label={part.label}
                      className="w-44 shrink-0 font-mono text-[11.5px]"
                    />
                    <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-fg/10">
                      <span
                        className="block h-full rounded-full bg-accent2"
                        style={{ width: `${max > 0 ? Math.max(2, Math.round((part.count / max) * 100)) : 0}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs">{plural(part.count, ...g.unit)}</span>
                    <span className="w-20 shrink-0 text-right text-[10.5px] text-muted">
                      {onDrill ? (
                        <DrillCount
                          value={part.users}
                          suffix={part.users === 1 ? ' person' : ' people'}
                          onClick={() =>
                            onDrill({
                              dimension: part.kind,
                              entity: part.key,
                              title: `${drillTitle[part.kind]} · ${part.key}`,
                            })
                          }
                        />
                      ) : (
                        plural(part.users, 'person', 'people')
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </div>
  );
}
