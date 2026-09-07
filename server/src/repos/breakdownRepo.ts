/**
 * Per-user drill-down behind any aggregate count (GET /api/breakdown).
 * Every dimension is an allowlisted spec — table, entity column and metric
 * columns are fixed here; nothing from the request reaches SQL as anything
 * but a bound parameter.
 */
import type { BreakdownColumn, BreakdownDimension, BreakdownUserRow } from '@dash/shared';
import type { Db } from '../db/connection';

interface MetricSpec {
  key: string;
  label: string;
  format: BreakdownColumn['format'];
  /** SQL expression over table alias t, aggregated per user */
  sql: string;
}

interface DimensionSpec {
  table: string;
  /** column matched against @entity; null = dimension has no entity filter */
  entityCol: string | null;
  metrics: MetricSpec[];
}

const DIMENSIONS: Record<Exclude<BreakdownDimension, 'version' | 'active-hour'>, DimensionSpec> = {
  skill: {
    table: 'otel_skill_daily',
    entityCol: 'skill_name',
    metrics: [
      { key: 'invocations', label: 'Invocations', format: 'number', sql: 'SUM(t.invocations)' },
      { key: 'userSlash', label: 'Typed /', format: 'number', sql: 'SUM(t.user_slash)' },
      { key: 'proactive', label: 'Proactive', format: 'number', sql: 'SUM(t.proactive)' },
      { key: 'costCents', label: 'Cost', format: 'cents', sql: 'SUM(t.cost_cents)' },
    ],
  },
  agent: {
    table: 'otel_agent_daily',
    entityCol: 'subagent_type',
    metrics: [
      { key: 'invocations', label: 'Invocations', format: 'number', sql: 'SUM(t.invocations)' },
      { key: 'success', label: 'Succeeded', format: 'number', sql: 'SUM(t.success)' },
      { key: 'failure', label: 'Failed', format: 'number', sql: 'SUM(t.failure)' },
      { key: 'costCents', label: 'Cost', format: 'cents', sql: 'SUM(t.cost_cents)' },
    ],
  },
  tool: {
    table: 'otel_tool_daily',
    entityCol: 'tool_name',
    metrics: [
      { key: 'uses', label: 'Uses', format: 'number', sql: 'SUM(t.uses)' },
      { key: 'success', label: 'Succeeded', format: 'number', sql: 'SUM(t.success)' },
      { key: 'failure', label: 'Failed', format: 'number', sql: 'SUM(t.failure)' },
      { key: 'accepted', label: 'Accepted', format: 'number', sql: 'SUM(t.accepted)' },
      { key: 'rejected', label: 'Rejected', format: 'number', sql: 'SUM(t.rejected)' },
    ],
  },
  mcp: {
    table: 'otel_mcp_daily',
    entityCol: 'server_name',
    metrics: [
      { key: 'toolCalls', label: 'Tool calls', format: 'number', sql: 'SUM(t.tool_calls)' },
      { key: 'toolFailures', label: 'Tool failures', format: 'number', sql: 'SUM(t.tool_failures)' },
      { key: 'connections', label: 'Connections', format: 'number', sql: 'SUM(t.connections)' },
      {
        key: 'connectionFailures',
        label: 'Conn. errors',
        format: 'number',
        sql: 'SUM(t.connection_failures)',
      },
      { key: 'costCents', label: 'Cost', format: 'cents', sql: 'SUM(t.cost_cents)' },
    ],
  },
  plugin: {
    table: 'otel_plugin_daily',
    entityCol: 'plugin_name',
    metrics: [
      { key: 'loads', label: 'Loads', format: 'number', sql: 'SUM(t.loads)' },
      { key: 'installs', label: 'Installs', format: 'number', sql: 'SUM(t.installs)' },
    ],
  },
  'model-reliability': {
    table: 'otel_reliability_daily',
    entityCol: 'model',
    metrics: [
      { key: 'apiRequests', label: 'Requests', format: 'number', sql: 'SUM(t.api_requests)' },
      { key: 'apiErrors', label: 'Errors', format: 'number', sql: 'SUM(t.api_errors)' },
      { key: 'errors429', label: '429s', format: 'number', sql: 'SUM(t.errors_429)' },
      { key: 'errors5xx', label: '5xx', format: 'number', sql: 'SUM(t.errors_5xx)' },
      { key: 'refusals', label: 'Refusals', format: 'number', sql: 'SUM(t.refusals)' },
    ],
  },
  'permission-mode': {
    table: 'otel_permission_mode_daily',
    entityCol: 'mode',
    metrics: [{ key: 'changes', label: 'Switches', format: 'number', sql: 'SUM(t.changes)' }],
  },
  'active-users': {
    table: 'usage_daily',
    entityCol: null,
    metrics: [
      { key: 'sessions', label: 'Sessions', format: 'number', sql: 'SUM(t.num_sessions)' },
      { key: 'linesAdded', label: 'Lines added', format: 'number', sql: 'SUM(t.lines_added)' },
      { key: 'commits', label: 'Commits', format: 'number', sql: 'SUM(t.commits)' },
    ],
  },
};

interface RawRow {
  user_id: number;
  name: string;
  email: string | null;
  team_id: number | null;
  last_date: string | null;
  [metric: string]: unknown;
}

export interface BreakdownResult {
  columns: BreakdownColumn[];
  rows: BreakdownUserRow[];
}

export class BreakdownRepo {
  constructor(private readonly db: Db) {}

  query(
    dimension: BreakdownDimension,
    entity: string,
    from: string,
    to: string,
    teamId?: number,
  ): BreakdownResult {
    if (dimension === 'version') return this.versionBreakdown(entity, teamId);
    if (dimension === 'active-hour') return this.hourBreakdown(entity, teamId);

    const spec = DIMENSIONS[dimension];
    const selects = spec.metrics
      .map((m) => `COALESCE(${m.sql}, 0) AS ${m.key}`)
      .join(',\n                ');
    let where = 't.date BETWEEN @from AND @to';
    const params: Record<string, unknown> = { from, to };
    if (spec.entityCol !== null) {
      where += ` AND t.${spec.entityCol} = @entity`;
      params['entity'] = entity;
    }
    if (teamId !== undefined) {
      where += ' AND u.team_id = @teamId';
      params['teamId'] = teamId;
    }

    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.name AS name, u.email AS email, u.team_id AS team_id,
                MAX(t.date) AS last_date,
                ${selects}
         FROM ${spec.table} t
         JOIN users u ON u.id = t.user_id
         WHERE ${where} AND u.actor_type = 'user'
         GROUP BY u.id
         ORDER BY ${spec.metrics[0]?.key ?? 'user_id'} DESC, u.name COLLATE NOCASE`,
      )
      .all(params) as RawRow[];

    return {
      columns: spec.metrics.map(({ key, label, format }) => ({ key, label, format })),
      rows: rows.map((r) => this.toUserRow(r, spec.metrics)),
    };
  }

  /** Current-state dimension: who runs Claude Code version @entity right now. */
  private versionBreakdown(entity: string, teamId?: number): BreakdownResult {
    let where = `cc_app_version = @entity AND actor_type = 'user'`;
    const params: Record<string, unknown> = { entity };
    if (teamId !== undefined) {
      where += ' AND team_id = @teamId';
      params['teamId'] = teamId;
    }
    const rows = this.db
      .prepare(
        `SELECT id AS user_id, name, email, team_id, NULL AS last_date
         FROM users WHERE ${where}
         ORDER BY name COLLATE NOCASE`,
      )
      .all(params) as RawRow[];
    return { columns: [], rows: rows.map((r) => this.toUserRow(r, [])) };
  }

  /**
   * Who was active in one hour bucket — the "Live today" bar drill-down.
   * otel_activity_hourly has no date column, so the range is ignored; the
   * hour itself is returned as last_date so the drawer can say "2h ago".
   */
  private hourBreakdown(hourUtc: string, teamId?: number): BreakdownResult {
    const metrics: MetricSpec[] = [
      { key: 'prompts', label: 'Prompts', format: 'number', sql: 'SUM(t.prompts)' },
      { key: 'apiRequests', label: 'API requests', format: 'number', sql: 'SUM(t.api_requests)' },
      { key: 'sessionsStarted', label: 'Sessions started', format: 'number', sql: 'SUM(t.sessions_started)' },
    ];
    const selects = metrics.map((m) => `COALESCE(${m.sql}, 0) AS ${m.key}`).join(', ');
    let where = `t.hour_utc = @entity AND u.actor_type = 'user'`;
    const params: Record<string, unknown> = { entity: hourUtc };
    if (teamId !== undefined) {
      where += ' AND u.team_id = @teamId';
      params['teamId'] = teamId;
    }
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.name AS name, u.email AS email, u.team_id AS team_id,
                MAX(t.hour_utc) AS last_date, ${selects}
         FROM otel_activity_hourly t
         JOIN users u ON u.id = t.user_id
         WHERE ${where}
         GROUP BY u.id
         ORDER BY prompts DESC, apiRequests DESC, u.name COLLATE NOCASE`,
      )
      .all(params) as RawRow[];
    return {
      columns: metrics.map(({ key, label, format }) => ({ key, label, format })),
      rows: rows.map((r) => this.toUserRow(r, metrics)),
    };
  }

  private toUserRow(r: RawRow, metrics: MetricSpec[]): BreakdownUserRow {
    const out: Record<string, number> = {};
    for (const m of metrics) out[m.key] = Number(r[m.key] ?? 0);
    return {
      userId: r.user_id,
      name: r.name,
      email: r.email,
      teamId: r.team_id,
      metrics: out,
      lastDate: r.last_date,
    };
  }
}
