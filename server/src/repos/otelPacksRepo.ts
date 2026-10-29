/**
 * Read-side queries for the telemetry packs (GET /api/telemetry/{activity,
 * reliability,governance,ecosystem}). All aggregate over the otel_* pack
 * tables written by the OTLP logs/metrics receivers, scoped exactly like
 * OtelRepo: userId narrows to one person, teamId joins users.team_id.
 */
import type { Db } from '../db/connection';
import { scopeParams, scopeSql, type OtelScope } from './otelRepo';

// ---------------------------------------------------------------------------
// Row shapes (snake_case straight from SQLite)
// ---------------------------------------------------------------------------

export interface ActivityTotalsRow {
  active_user_s: number;
  active_cli_s: number;
  prompts: number;
  sessions: number;
}

export interface ActivityDailyRow extends ActivityTotalsRow {
  date: string;
}

export interface ActivityHourlyRow {
  hour_utc: string;
  prompts: number;
  api_requests: number;
  active_users: number;
}

export interface ActivityPerUserRow {
  user_id: number;
  name: string;
  email: string | null;
  active_user_s: number;
  prompts: number;
  sessions: number;
}

export interface SessionDurationRow {
  user_id: number;
  dur_ms: number;
}

export interface ReliabilityTotalsRow {
  api_requests: number;
  api_errors: number;
  errors_429: number;
  errors_5xx: number;
  errors_other: number;
  refusals: number;
  compactions: number;
  internal_errors: number;
  total_duration_ms: number;
}

export interface ReliabilityByModelRow {
  model: string;
  api_requests: number;
  api_errors: number;
  refusals: number;
  total_duration_ms: number;
}

export interface ReliabilityDailyRow {
  date: string;
  api_requests: number;
  api_errors: number;
  refusals: number;
}

export interface GovernanceTotalsRow {
  src_config: number;
  src_hook: number;
  src_user_permanent: number;
  src_user_temporary: number;
  src_user_abort: number;
  src_user_reject: number;
}

export interface PermissionModeRow {
  mode: string;
  changes: number;
  users: number;
}

export interface GovernancePerUserRow extends GovernanceTotalsRow {
  user_id: number;
  name: string;
  email: string | null;
  permission_mode_changes: number;
}

export interface McpServerRow {
  server_name: string;
  tool_calls: number;
  tool_failures: number;
  tokens: number;
  cost_cents: number;
  connections: number;
  connection_failures: number;
  users: number;
}

export interface McpDailyRow {
  date: string;
  tool_calls: number;
  tool_failures: number;
  connections: number;
  connection_failures: number;
}

export interface PluginRow {
  plugin_name: string;
  installs: number;
  loads: number;
  users: number;
}

/** One (skill, user) cell in range, with the plugin telemetry named for the skill, if any. */
export interface PluginSkillUserRow {
  skill_name: string;
  meta_plugin: string | null;
  user_id: number;
  invocations: number;
  cost_cents: number;
}

/** One (MCP server, user) cell in range — only servers named the way plugin MCP servers are. */
export interface PluginMcpUserRow {
  server_name: string;
  user_id: number;
  tool_calls: number;
}

/** One (agent type, user) cell in range — only 'prefix:agent' names, the shape plugin agents have. */
export interface PluginAgentUserRow {
  subagent_type: string;
  user_id: number;
  invocations: number;
}

export interface AppVersionRow {
  app_version: string;
  users: number;
}

export interface ModelMixRow {
  model: string;
  speed: string;
  effort: string;
  tokens: number;
  cost_cents: number;
}

export class OtelPacksRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Activity
  // -------------------------------------------------------------------------

  activityTotals(from: string, to: string, scope: OtelScope = {}): ActivityTotalsRow {
    const { fromSql, whereSql } = scopeSql('otel_activity_daily', scope);
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(t.active_user_s), 0) AS active_user_s,
                COALESCE(SUM(t.active_cli_s), 0)  AS active_cli_s,
                COALESCE(SUM(t.prompts), 0)       AS prompts,
                COALESCE(SUM(t.sessions), 0)      AS sessions
         FROM ${fromSql}
         WHERE ${whereSql}`,
      )
      .get(scopeParams(from, to, scope)) as ActivityTotalsRow;
  }

  activityDaily(from: string, to: string, scope: OtelScope = {}): ActivityDailyRow[] {
    const { fromSql, whereSql } = scopeSql('otel_activity_daily', scope);
    return this.db
      .prepare(
        `SELECT t.date AS date,
                COALESCE(SUM(t.active_user_s), 0) AS active_user_s,
                COALESCE(SUM(t.active_cli_s), 0)  AS active_cli_s,
                COALESCE(SUM(t.prompts), 0)       AS prompts,
                COALESCE(SUM(t.sessions), 0)      AS sessions
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.date
         ORDER BY t.date`,
      )
      .all(scopeParams(from, to, scope)) as ActivityDailyRow[];
  }

  /** Hour buckets at/after `sinceHourUtc` — the "last 24h" live strip. */
  activityHourly(sinceHourUtc: string, scope: OtelScope = {}): ActivityHourlyRow[] {
    const joins = scope.teamId !== undefined ? ' JOIN users u ON u.id = t.user_id' : '';
    let where = 't.hour_utc >= @since';
    if (scope.teamId !== undefined) where += ' AND u.team_id = @teamId';
    if (scope.userId !== undefined) where += ' AND t.user_id = @userId';
    const params: Record<string, unknown> = { since: sinceHourUtc };
    if (scope.teamId !== undefined) params['teamId'] = scope.teamId;
    if (scope.userId !== undefined) params['userId'] = scope.userId;
    return this.db
      .prepare(
        `SELECT t.hour_utc AS hour_utc,
                COALESCE(SUM(t.prompts), 0)      AS prompts,
                COALESCE(SUM(t.api_requests), 0) AS api_requests,
                COUNT(DISTINCT t.user_id)        AS active_users
         FROM otel_activity_hourly t${joins}
         WHERE ${where}
         GROUP BY t.hour_utc
         ORDER BY t.hour_utc`,
      )
      .all(params) as ActivityHourlyRow[];
  }

  /** Wall-clock durations (last - first event) of sessions started in range. */
  sessionDurations(from: string, to: string, scope: OtelScope = {}): SessionDurationRow[] {
    const { fromSql, whereSql } = scopeSql('otel_sessions', scope);
    return this.db
      .prepare(
        `SELECT t.user_id AS user_id,
                (julianday(t.last_event_at) - julianday(t.first_event_at)) * 86400000.0 AS dur_ms
         FROM ${fromSql}
         WHERE ${whereSql}`,
      )
      .all(scopeParams(from, to, scope)) as SessionDurationRow[];
  }

  activityPerUser(from: string, to: string, scope: OtelScope = {}): ActivityPerUserRow[] {
    let where = 't.date BETWEEN @from AND @to';
    if (scope.teamId !== undefined) where += ' AND u.team_id = @teamId';
    if (scope.userId !== undefined) where += ' AND t.user_id = @userId';
    return this.db
      .prepare(
        `SELECT t.user_id AS user_id, u.name AS name, u.email AS email,
                COALESCE(SUM(t.active_user_s), 0) AS active_user_s,
                COALESCE(SUM(t.prompts), 0)       AS prompts,
                COALESCE(SUM(t.sessions), 0)      AS sessions
         FROM otel_activity_daily t JOIN users u ON u.id = t.user_id
         WHERE ${where}
         GROUP BY t.user_id
         ORDER BY active_user_s DESC, prompts DESC, t.user_id`,
      )
      .all(scopeParams(from, to, scope)) as ActivityPerUserRow[];
  }

  // -------------------------------------------------------------------------
  // Reliability
  // -------------------------------------------------------------------------

  reliabilityTotals(from: string, to: string, scope: OtelScope = {}): ReliabilityTotalsRow {
    const { fromSql, whereSql } = scopeSql('otel_reliability_daily', scope);
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(t.api_requests), 0)      AS api_requests,
                COALESCE(SUM(t.api_errors), 0)        AS api_errors,
                COALESCE(SUM(t.errors_429), 0)        AS errors_429,
                COALESCE(SUM(t.errors_5xx), 0)        AS errors_5xx,
                COALESCE(SUM(t.errors_other), 0)      AS errors_other,
                COALESCE(SUM(t.refusals), 0)          AS refusals,
                COALESCE(SUM(t.compactions), 0)       AS compactions,
                COALESCE(SUM(t.internal_errors), 0)   AS internal_errors,
                COALESCE(SUM(t.total_duration_ms), 0) AS total_duration_ms
         FROM ${fromSql}
         WHERE ${whereSql}`,
      )
      .get(scopeParams(from, to, scope)) as ReliabilityTotalsRow;
  }

  /** Per-model API health; pure bookkeeping rows (model='' compactions) are skipped. */
  reliabilityByModel(from: string, to: string, scope: OtelScope = {}): ReliabilityByModelRow[] {
    const { fromSql, whereSql } = scopeSql('otel_reliability_daily', scope);
    return this.db
      .prepare(
        `SELECT t.model AS model,
                COALESCE(SUM(t.api_requests), 0)      AS api_requests,
                COALESCE(SUM(t.api_errors), 0)        AS api_errors,
                COALESCE(SUM(t.refusals), 0)          AS refusals,
                COALESCE(SUM(t.total_duration_ms), 0) AS total_duration_ms
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.model
         HAVING api_requests + api_errors + refusals > 0
         ORDER BY api_requests DESC, model`,
      )
      .all(scopeParams(from, to, scope)) as ReliabilityByModelRow[];
  }

  reliabilityDaily(from: string, to: string, scope: OtelScope = {}): ReliabilityDailyRow[] {
    const { fromSql, whereSql } = scopeSql('otel_reliability_daily', scope);
    return this.db
      .prepare(
        `SELECT t.date AS date,
                COALESCE(SUM(t.api_requests), 0) AS api_requests,
                COALESCE(SUM(t.api_errors), 0)   AS api_errors,
                COALESCE(SUM(t.refusals), 0)     AS refusals
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.date
         ORDER BY t.date`,
      )
      .all(scopeParams(from, to, scope)) as ReliabilityDailyRow[];
  }

  // -------------------------------------------------------------------------
  // Governance
  // -------------------------------------------------------------------------

  governanceTotals(from: string, to: string, scope: OtelScope = {}): GovernanceTotalsRow {
    const { fromSql, whereSql } = scopeSql('otel_governance_daily', scope);
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(t.src_config), 0)         AS src_config,
                COALESCE(SUM(t.src_hook), 0)           AS src_hook,
                COALESCE(SUM(t.src_user_permanent), 0) AS src_user_permanent,
                COALESCE(SUM(t.src_user_temporary), 0) AS src_user_temporary,
                COALESCE(SUM(t.src_user_abort), 0)     AS src_user_abort,
                COALESCE(SUM(t.src_user_reject), 0)    AS src_user_reject
         FROM ${fromSql}
         WHERE ${whereSql}`,
      )
      .get(scopeParams(from, to, scope)) as GovernanceTotalsRow;
  }

  permissionModes(from: string, to: string, scope: OtelScope = {}): PermissionModeRow[] {
    const { fromSql, whereSql } = scopeSql('otel_permission_mode_daily', scope);
    return this.db
      .prepare(
        `SELECT t.mode AS mode,
                COALESCE(SUM(t.changes), 0) AS changes,
                COUNT(DISTINCT CASE WHEN t.changes > 0 THEN t.user_id END) AS users
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.mode
         ORDER BY changes DESC, mode`,
      )
      .all(scopeParams(from, to, scope)) as PermissionModeRow[];
  }

  governancePerUser(from: string, to: string, scope: OtelScope = {}): GovernancePerUserRow[] {
    let where = 't.date BETWEEN @from AND @to';
    if (scope.teamId !== undefined) where += ' AND u.team_id = @teamId';
    if (scope.userId !== undefined) where += ' AND t.user_id = @userId';
    return this.db
      .prepare(
        `SELECT t.user_id AS user_id, u.name AS name, u.email AS email,
                COALESCE(SUM(t.src_config), 0)              AS src_config,
                COALESCE(SUM(t.src_hook), 0)                AS src_hook,
                COALESCE(SUM(t.src_user_permanent), 0)      AS src_user_permanent,
                COALESCE(SUM(t.src_user_temporary), 0)      AS src_user_temporary,
                COALESCE(SUM(t.src_user_abort), 0)          AS src_user_abort,
                COALESCE(SUM(t.src_user_reject), 0)         AS src_user_reject,
                COALESCE(SUM(t.permission_mode_changes), 0) AS permission_mode_changes
         FROM otel_governance_daily t JOIN users u ON u.id = t.user_id
         WHERE ${where}
         GROUP BY t.user_id
         ORDER BY src_config + src_hook + src_user_permanent + src_user_temporary
                  + src_user_abort + src_user_reject DESC, t.user_id`,
      )
      .all(scopeParams(from, to, scope)) as GovernancePerUserRow[];
  }

  // -------------------------------------------------------------------------
  // Ecosystem
  // -------------------------------------------------------------------------

  mcpServers(from: string, to: string, scope: OtelScope = {}): McpServerRow[] {
    const { fromSql, whereSql } = scopeSql('otel_mcp_daily', scope);
    return this.db
      .prepare(
        `SELECT t.server_name AS server_name,
                COALESCE(SUM(t.tool_calls), 0)          AS tool_calls,
                COALESCE(SUM(t.tool_failures), 0)       AS tool_failures,
                COALESCE(SUM(t.tokens), 0)              AS tokens,
                COALESCE(SUM(t.cost_cents), 0)          AS cost_cents,
                COALESCE(SUM(t.connections), 0)         AS connections,
                COALESCE(SUM(t.connection_failures), 0) AS connection_failures,
                COUNT(DISTINCT t.user_id)               AS users
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.server_name
         ORDER BY tool_calls DESC, server_name`,
      )
      .all(scopeParams(from, to, scope)) as McpServerRow[];
  }

  mcpDaily(from: string, to: string, scope: OtelScope = {}): McpDailyRow[] {
    const { fromSql, whereSql } = scopeSql('otel_mcp_daily', scope);
    return this.db
      .prepare(
        `SELECT t.date AS date,
                COALESCE(SUM(t.tool_calls), 0)          AS tool_calls,
                COALESCE(SUM(t.tool_failures), 0)       AS tool_failures,
                COALESCE(SUM(t.connections), 0)         AS connections,
                COALESCE(SUM(t.connection_failures), 0) AS connection_failures
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.date
         ORDER BY t.date`,
      )
      .all(scopeParams(from, to, scope)) as McpDailyRow[];
  }

  plugins(from: string, to: string, scope: OtelScope = {}): PluginRow[] {
    const { fromSql, whereSql } = scopeSql('otel_plugin_daily', scope);
    return this.db
      .prepare(
        `SELECT t.plugin_name AS plugin_name,
                COALESCE(SUM(t.installs), 0) AS installs,
                COALESCE(SUM(t.loads), 0)    AS loads,
                COUNT(DISTINCT t.user_id)    AS users
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.plugin_name
         ORDER BY loads DESC, plugin_name`,
      )
      .all(scopeParams(from, to, scope)) as PluginRow[];
  }

  /**
   * Skill runs per (skill, user) in range, joined to the plugin skill_activated
   * named. Attribution to plugins (incl. the 'prefix:' fallback) happens in the
   * route — distinct users per plugin need the user ids.
   */
  pluginSkillUsers(from: string, to: string, scope: OtelScope = {}): PluginSkillUserRow[] {
    const { fromSql, whereSql } = scopeSql('otel_skill_daily', scope);
    return this.db
      .prepare(
        `SELECT t.skill_name AS skill_name,
                m.plugin_name AS meta_plugin,
                t.user_id AS user_id,
                COALESCE(SUM(t.invocations), 0) AS invocations,
                COALESCE(SUM(t.cost_cents), 0)  AS cost_cents
         FROM ${fromSql}
         LEFT JOIN otel_skill_meta m ON m.skill_name = t.skill_name
         WHERE ${whereSql} AND t.invocations > 0
         GROUP BY t.skill_name, t.user_id`,
      )
      .all(scopeParams(from, to, scope)) as PluginSkillUserRow[];
  }

  /** MCP tool calls per (plugin-named server, user) in range; connection-only rows are left out. */
  pluginMcpUsers(from: string, to: string, scope: OtelScope = {}): PluginMcpUserRow[] {
    const { fromSql, whereSql } = scopeSql('otel_mcp_daily', scope);
    return this.db
      .prepare(
        `SELECT t.server_name AS server_name,
                t.user_id AS user_id,
                COALESCE(SUM(t.tool_calls), 0) AS tool_calls
         FROM ${fromSql}
         WHERE ${whereSql} AND t.tool_calls > 0
           AND (t.server_name LIKE 'plugin\\_%' ESCAPE '\\' OR t.server_name LIKE 'plugin:%')
         GROUP BY t.server_name, t.user_id`,
      )
      .all(scopeParams(from, to, scope)) as PluginMcpUserRow[];
  }

  /** Agent runs per ('prefix:agent' type, user) in range; the route keeps prefixes that are plugins. */
  pluginAgentUsers(from: string, to: string, scope: OtelScope = {}): PluginAgentUserRow[] {
    const { fromSql, whereSql } = scopeSql('otel_agent_daily', scope);
    return this.db
      .prepare(
        `SELECT t.subagent_type AS subagent_type,
                t.user_id AS user_id,
                COALESCE(SUM(t.invocations), 0) AS invocations
         FROM ${fromSql}
         WHERE ${whereSql} AND t.invocations > 0 AND instr(t.subagent_type, ':') > 1
         GROUP BY t.subagent_type, t.user_id`,
      )
      .all(scopeParams(from, to, scope)) as PluginAgentUserRow[];
  }

  /** Every plugin name Claude Code ever reported loading or installing (range-independent). */
  knownPluginNames(): Set<string> {
    const rows = this.db.prepare(`SELECT DISTINCT plugin_name FROM otel_plugin_daily`).all() as Array<{
      plugin_name: string;
    }>;
    return new Set(rows.map((r) => r.plugin_name));
  }

  /** Latest observed Claude Code version per user, grouped (current state, no range). */
  appVersions(scope: OtelScope = {}): AppVersionRow[] {
    let where = 'cc_app_version IS NOT NULL';
    const params: Record<string, unknown> = {};
    if (scope.teamId !== undefined) {
      where += ' AND team_id = @teamId';
      params['teamId'] = scope.teamId;
    }
    if (scope.userId !== undefined) {
      where += ' AND id = @userId';
      params['userId'] = scope.userId;
    }
    return this.db
      .prepare(
        `SELECT cc_app_version AS app_version, COUNT(*) AS users
         FROM users
         WHERE ${where}
         GROUP BY cc_app_version`,
      )
      .all(params) as AppVersionRow[];
  }

  modelMix(from: string, to: string, scope: OtelScope = {}): ModelMixRow[] {
    const { fromSql, whereSql } = scopeSql('otel_token_mix_daily', scope);
    return this.db
      .prepare(
        `SELECT t.model AS model, t.speed AS speed, t.effort AS effort,
                COALESCE(SUM(t.tokens), 0)     AS tokens,
                COALESCE(SUM(t.cost_cents), 0) AS cost_cents
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.model, t.speed, t.effort
         ORDER BY tokens DESC, model, speed, effort`,
      )
      .all(scopeParams(from, to, scope)) as ModelMixRow[];
  }

  // -------------------------------------------------------------------------
  // hasData — any rows in range across the given pack's own date-keyed tables
  // -------------------------------------------------------------------------

  hasRows(tables: string[], from: string, to: string, scope: OtelScope = {}): boolean {
    for (const table of tables) {
      const { fromSql, whereSql } = scopeSql(table, scope);
      const row = this.db
        .prepare(`SELECT 1 AS one FROM ${fromSql} WHERE ${whereSql} LIMIT 1`)
        .get(scopeParams(from, to, scope)) as { one: number } | undefined;
      if (row) return true;
    }
    return false;
  }

  /** otel_activity_hourly has no date column — compare on the hour prefix. */
  hasHourlyRows(from: string, to: string, scope: OtelScope = {}): boolean {
    const joins = scope.teamId !== undefined ? ' JOIN users u ON u.id = t.user_id' : '';
    let where = `substr(t.hour_utc, 1, 10) BETWEEN @from AND @to`;
    if (scope.teamId !== undefined) where += ' AND u.team_id = @teamId';
    if (scope.userId !== undefined) where += ' AND t.user_id = @userId';
    const row = this.db
      .prepare(`SELECT 1 AS one FROM otel_activity_hourly t${joins} WHERE ${where} LIMIT 1`)
      .get(scopeParams(from, to, scope)) as { one: number } | undefined;
    return row !== undefined;
  }
}
