/**
 * Telemetry pack endpoints — GET /api/telemetry/{activity,reliability,
 * governance,ecosystem,mcp,plugins}. Same query contract as /api/skills: from/to
 * (default last 30 days) + optional teamId/userId scoping. Data comes from
 * the otel_* pack tables (migration 006) fed by both OTLP receivers.
 */
import type {
  ActivityResponse,
  DecisionSource,
  EcosystemResponse,
  GovernanceResponse,
  McpResponse,
  PluginUsageRow,
  PluginsResponse,
  ReliabilityResponse,
} from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { PluginAgentUserRow, PluginMcpUserRow, PluginRow, PluginSkillUserRow } from '../repos/otelPacksRepo';
import type { OtelScope } from '../repos/otelRepo';
import { avgMs, errorRate, mean, median } from '../services/packMath';
import { hourIsoOf } from '../util/time';
import { parseRangeQuery, rangeQuerySchema, zodMessage, BadRequestError } from './shared';

const packsQuerySchema = rangeQuerySchema.extend({
  /** scopes every list to one user */
  userId: z.coerce.number().int().positive().optional(),
});

interface ParsedPacksQuery {
  from: string;
  to: string;
  scope: OtelScope;
}

function parsePacksQuery(query: unknown): ParsedPacksQuery {
  const parsed = packsQuerySchema.safeParse(query ?? {});
  if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
  const q = parseRangeQuery(query);
  const scope: OtelScope = {};
  if (q.teamId !== undefined) scope.teamId = q.teamId;
  if (parsed.data.userId !== undefined) scope.userId = parsed.data.userId;
  return { from: q.from, to: q.to, scope };
}


/**
 * The plugin a skill run belongs to: the one skill_activated named, else its
 * 'prefix:' when that prefix is a known plugin. A bare prefix alone is not
 * enough — project skills arrive as '<folder>:<skill>' too.
 */
function pluginOf(row: PluginSkillUserRow, known: Set<string>): string | null {
  if (row.meta_plugin) return row.meta_plugin;
  const sep = row.skill_name.indexOf(':');
  if (sep <= 0) return null;
  const prefix = row.skill_name.slice(0, sep);
  return known.has(prefix) ? prefix : null;
}

/**
 * The plugin an MCP server belongs to. Connection events name it
 * 'plugin:<plugin>:<server>'; tool calls 'plugin_<plugin>_<server>', where a
 * plugin name may itself hold '_' or share a prefix with another plugin — so
 * the longest known plugin wins, and an unknown one falls back to the first
 * '_'-separated segment.
 */
export function mcpPluginOf(server: string, known: Set<string>): string | null {
  if (server.startsWith('plugin:')) {
    const name = server.slice('plugin:'.length).split(':')[0];
    return name || null;
  }
  if (!server.startsWith('plugin_')) return null;
  let best: string | null = null;
  for (const p of known) {
    if (server.startsWith(`plugin_${p}_`) && (!best || p.length > best.length)) best = p;
  }
  if (best) return best;
  const rest = server.slice('plugin_'.length);
  const sep = rest.indexOf('_');
  return sep > 0 ? rest.slice(0, sep) : null;
}

/** The plugin an agent belongs to: its 'prefix:' when that prefix is a known plugin. */
function agentPluginOf(type: string, known: Set<string>): string | null {
  const sep = type.indexOf(':');
  if (sep <= 0) return null;
  const prefix = type.slice(0, sep);
  return known.has(prefix) ? prefix : null;
}

interface PluginInputs {
  skills: PluginSkillUserRow[];
  mcp: PluginMcpUserRow[];
  agents: PluginAgentUserRow[];
  loads: PluginRow[];
  known: Set<string>;
}

/**
 * Plugins ranked by the people who used them — through a skill, an MCP tool
 * or an agent — then by calls. Loaded-but-unused ones trail, by loads.
 */
export function rankPlugins({ skills, mcp, agents, loads, known }: PluginInputs): {
  plugins: PluginUsageRow[];
  users: number;
} {
  const all = new Set(known);
  for (const c of skills) if (c.meta_plugin) all.add(c.meta_plugin);

  interface Part {
    count: number;
    costCents: number;
    users: Set<number>;
  }
  interface Acc {
    row: PluginUsageRow;
    users: Set<number>;
    skills: Map<string, Part>;
    mcp: Map<string, Part>;
    agents: Map<string, Part>;
  }
  const byPlugin = new Map<string, Acc>();
  const everyone = new Set<number>();
  const acc = (name: string): Acc => {
    let a = byPlugin.get(name);
    if (!a) {
      a = {
        row: {
          pluginName: name,
          users: 0,
          calls: 0,
          invocations: 0,
          mcpCalls: 0,
          agentRuns: 0,
          costCents: 0,
          loads: 0,
          installs: 0,
          loadUsers: 0,
          skills: [],
          mcpServers: [],
          agents: [],
        },
        users: new Set(),
        skills: new Map(),
        mcp: new Map(),
        agents: new Map(),
      };
      byPlugin.set(name, a);
    }
    return a;
  };
  const add = (parts: Map<string, Part>, key: string, count: number, costCents: number, userId: number) => {
    let p = parts.get(key);
    if (!p) {
      p = { count: 0, costCents: 0, users: new Set() };
      parts.set(key, p);
    }
    p.count += count;
    p.costCents += costCents;
    p.users.add(userId);
  };

  for (const c of skills) {
    const plugin = pluginOf(c, all);
    if (!plugin) continue;
    const a = acc(plugin);
    a.row.invocations += c.invocations;
    a.row.costCents += c.cost_cents;
    a.users.add(c.user_id);
    add(a.skills, c.skill_name, c.invocations, c.cost_cents, c.user_id);
  }
  for (const c of mcp) {
    const plugin = mcpPluginOf(c.server_name, all);
    if (!plugin) continue;
    const a = acc(plugin);
    a.row.mcpCalls += c.tool_calls;
    a.users.add(c.user_id);
    add(a.mcp, c.server_name, c.tool_calls, 0, c.user_id);
  }
  for (const c of agents) {
    const plugin = agentPluginOf(c.subagent_type, all);
    if (!plugin) continue;
    const a = acc(plugin);
    a.row.agentRuns += c.invocations;
    a.users.add(c.user_id);
    add(a.agents, c.subagent_type, c.invocations, 0, c.user_id);
  }
  for (const l of loads) {
    const a = acc(l.plugin_name);
    a.row.loads = l.loads;
    a.row.installs = l.installs;
    a.row.loadUsers = l.users;
  }

  const byCount = <T extends { count: number; name: string }>(x: T, y: T) =>
    y.count - x.count || x.name.localeCompare(y.name);
  const list = (parts: Map<string, Part>) =>
    [...parts.entries()].map(([name, p]) => ({ name, count: p.count, costCents: p.costCents, users: p.users.size })).sort(byCount);

  const plugins = [...byPlugin.values()]
    .map(({ row, users, skills: s, mcp: m, agents: g }) => {
      for (const id of users) everyone.add(id);
      return {
        ...row,
        users: users.size,
        calls: row.invocations + row.mcpCalls + row.agentRuns,
        skills: list(s).map((x) => ({ skillName: x.name, invocations: x.count, users: x.users, costCents: x.costCents })),
        mcpServers: list(m).map((x) => ({ serverName: x.name, calls: x.count, users: x.users })),
        agents: list(g).map((x) => ({ agentType: x.name, runs: x.count, users: x.users })),
      };
    })
    .sort(
      (x, y) =>
        y.users - x.users || y.calls - x.calls || y.loads - x.loads || x.pluginName.localeCompare(y.pluginName),
    );
  return { plugins, users: everyone.size };
}

/** '2.10.1' before '2.9.3' — numeric per dot-segment, newest first. */
function semverDesc(a: string, b: string): number {
  const pa = a.split('.').map((s) => Number.parseInt(s, 10));
  const pb = b.split('.').map((s) => Number.parseInt(s, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.isFinite(pa[i]) ? (pa[i] as number) : 0;
    const nb = Number.isFinite(pb[i]) ? (pb[i] as number) : 0;
    if (na !== nb) return nb - na;
  }
  return b.localeCompare(a);
}

export function registerTelemetryPackRoutes(app: FastifyInstance, ctx: AppContext): void {
  const packs = () => ctx.repos.otelPacks;

  app.get('/api/telemetry/activity', async (req): Promise<ActivityResponse> => {
    const { from, to, scope } = parsePacksQuery(req.query);
    const repo = packs();

    const totals = repo.activityTotals(from, to, scope);
    const durations = repo.sessionDurations(from, to, scope);
    const allDurations = durations.map((d) => d.dur_ms);

    // per-user avg session span, from the same otel_sessions rows
    const perUserDurations = new Map<number, number[]>();
    for (const d of durations) {
      const list = perUserDurations.get(d.user_id);
      if (list) list.push(d.dur_ms);
      else perUserDurations.set(d.user_id, [d.dur_ms]);
    }

    // last 24 hour buckets, including the current partial hour
    const sinceHour = hourIsoOf(new Date(Date.now() - 23 * 3_600_000));

    return {
      range: { from, to },
      hasData:
        repo.hasRows(['otel_activity_daily', 'otel_sessions'], from, to, scope) ||
        repo.hasHourlyRows(from, to, scope),
      totals: {
        activeUserSeconds: totals.active_user_s,
        activeCliSeconds: totals.active_cli_s,
        prompts: totals.prompts,
        sessions: totals.sessions,
        avgSessionMs: mean(allDurations),
        medianSessionMs: median(allDurations),
      },
      daily: repo.activityDaily(from, to, scope).map((r) => ({
        date: r.date,
        activeUserSeconds: r.active_user_s,
        activeCliSeconds: r.active_cli_s,
        prompts: r.prompts,
        sessions: r.sessions,
      })),
      hourly: repo.activityHourly(sinceHour, scope).map((r) => ({
        hourUtc: r.hour_utc,
        prompts: r.prompts,
        apiRequests: r.api_requests,
        activeUsers: r.active_users,
      })),
      perUser: repo.activityPerUser(from, to, scope).map((r) => ({
        userId: r.user_id,
        name: r.name,
        email: r.email,
        activeUserSeconds: r.active_user_s,
        prompts: r.prompts,
        sessions: r.sessions,
        avgSessionMs: mean(perUserDurations.get(r.user_id) ?? []),
      })),
    };
  });

  app.get('/api/telemetry/reliability', async (req): Promise<ReliabilityResponse> => {
    const { from, to, scope } = parsePacksQuery(req.query);
    const repo = packs();
    const t = repo.reliabilityTotals(from, to, scope);

    return {
      range: { from, to },
      hasData: repo.hasRows(['otel_reliability_daily'], from, to, scope),
      totals: {
        apiRequests: t.api_requests,
        apiErrors: t.api_errors,
        refusals: t.refusals,
        compactions: t.compactions,
        internalErrors: t.internal_errors,
        errorRate: errorRate(t.api_requests, t.api_errors),
        avgRequestMs: avgMs(t.total_duration_ms, t.api_requests),
      },
      byModel: repo.reliabilityByModel(from, to, scope).map((r) => ({
        model: r.model,
        apiRequests: r.api_requests,
        apiErrors: r.api_errors,
        errorRate: errorRate(r.api_requests, r.api_errors),
        refusals: r.refusals,
        avgRequestMs: avgMs(r.total_duration_ms, r.api_requests),
      })),
      daily: repo.reliabilityDaily(from, to, scope).map((r) => ({
        date: r.date,
        apiRequests: r.api_requests,
        apiErrors: r.api_errors,
        refusals: r.refusals,
      })),
      errorStatuses: { e429: t.errors_429, e5xx: t.errors_5xx, other: t.errors_other },
    };
  });

  app.get('/api/telemetry/governance', async (req): Promise<GovernanceResponse> => {
    const { from, to, scope } = parsePacksQuery(req.query);
    const repo = packs();
    const t = repo.governanceTotals(from, to, scope);

    const decisionSources: Record<DecisionSource, number> = {
      config: t.src_config,
      hook: t.src_hook,
      user_permanent: t.src_user_permanent,
      user_temporary: t.src_user_temporary,
      user_abort: t.src_user_abort,
      user_reject: t.src_user_reject,
    };

    return {
      range: { from, to },
      hasData: repo.hasRows(['otel_governance_daily', 'otel_permission_mode_daily'], from, to, scope),
      decisionSources,
      permissionModes: repo.permissionModes(from, to, scope).map((r) => ({
        mode: r.mode,
        changes: r.changes,
        users: r.users,
      })),
      perUser: repo.governancePerUser(from, to, scope).map((r) => {
        const auto = r.src_config + r.src_hook + r.src_user_permanent;
        const all = auto + r.src_user_temporary + r.src_user_abort + r.src_user_reject;
        return {
          userId: r.user_id,
          name: r.name,
          email: r.email,
          autoApprovedShare: all > 0 ? auto / all : null,
          rejects: r.src_user_reject,
          aborts: r.src_user_abort,
          modeChanges: r.permission_mode_changes,
        };
      }),
    };
  });

  const mapMcpServers = (rows: ReturnType<AppContext['repos']['otelPacks']['mcpServers']>) =>
    rows.map((r) => ({
      serverName: r.server_name,
      toolCalls: r.tool_calls,
      toolFailures: r.tool_failures,
      tokens: r.tokens,
      costCents: r.cost_cents,
      connections: r.connections,
      connectionFailures: r.connection_failures,
      users: r.users,
    }));

  app.get('/api/telemetry/mcp', async (req): Promise<McpResponse> => {
    const { from, to, scope } = parsePacksQuery(req.query);
    const repo = packs();
    const tools = ctx.repos.otel.mcpToolTotals(from, to, scope);

    return {
      range: { from, to },
      hasData: repo.hasRows(['otel_mcp_daily'], from, to, scope) || tools.length > 0,
      servers: mapMcpServers(repo.mcpServers(from, to, scope)),
      tools: tools.map((r) => {
        const judged = r.success + r.failure;
        return {
          toolName: r.tool_name,
          uses: r.uses,
          users: r.users,
          successRate: judged > 0 ? r.success / judged : null,
          judged,
          accepted: r.accepted,
          rejected: r.rejected,
        };
      }),
      daily: repo.mcpDaily(from, to, scope).map((r) => ({
        date: r.date,
        toolCalls: r.tool_calls,
        toolFailures: r.tool_failures,
        connections: r.connections,
        connectionFailures: r.connection_failures,
      })),
    };
  });

  app.get('/api/telemetry/plugins', async (req): Promise<PluginsResponse> => {
    const { from, to, scope } = parsePacksQuery(req.query);
    const repo = packs();
    const { plugins, users } = rankPlugins({
      skills: repo.pluginSkillUsers(from, to, scope),
      mcp: repo.pluginMcpUsers(from, to, scope),
      agents: repo.pluginAgentUsers(from, to, scope),
      loads: repo.plugins(from, to, scope),
      known: repo.knownPluginNames(),
    });
    return { range: { from, to }, hasData: plugins.length > 0, users, plugins };
  });

  app.get('/api/telemetry/ecosystem', async (req): Promise<EcosystemResponse> => {
    const { from, to, scope } = parsePacksQuery(req.query);
    const repo = packs();

    return {
      range: { from, to },
      hasData: repo.hasRows(['otel_mcp_daily', 'otel_plugin_daily', 'otel_token_mix_daily'], from, to, scope),
      mcpServers: mapMcpServers(repo.mcpServers(from, to, scope)),
      plugins: repo.plugins(from, to, scope).map((r) => ({
        pluginName: r.plugin_name,
        installs: r.installs,
        loads: r.loads,
        users: r.users,
      })),
      versions: repo
        .appVersions(scope)
        .map((r) => ({ appVersion: r.app_version, users: r.users }))
        .sort((a, b) => semverDesc(a.appVersion, b.appVersion)),
      modelMix: repo.modelMix(from, to, scope).map((r) => ({
        model: r.model,
        speed: r.speed,
        effort: r.effort,
        tokens: r.tokens,
        costCents: r.cost_cents,
      })),
    };
  });
}
