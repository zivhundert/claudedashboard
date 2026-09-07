import { utcHourRangeOfLocalDays } from '@dash/shared';
import type { Db } from '../db/connection';
import { orgTimezone } from '../util/time';

// ---------------------------------------------------------------------------
// Row shapes returned by the aggregate queries
// ---------------------------------------------------------------------------

export interface PeopleKpiRow {
  sessions: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  pull_requests: number;
  accepted: number;
  rejected: number;
  active_users: number;
  active_rostered: number;
}

export interface TokenCostRow {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_cents: number;
}

export interface DailyCoreRow {
  date: string;
  sessions: number;
  active_users: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  pull_requests: number;
}

export interface DailyCostRow {
  date: string;
  cost_cents: number;
}

export interface ModelTotalsRow extends TokenCostRow {
  model: string;
}

export interface ModelDailyCostRow {
  date: string;
  model: string;
  cost_cents: number;
}

export interface TerminalMixRow {
  terminal_type: string;
  sessions: number;
}

export interface PerUserDailyRow {
  user_id: number;
  sessions: number;
  active_days: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  pull_requests: number;
  edit_accepted: number;
  edit_rejected: number;
  multi_edit_accepted: number;
  multi_edit_rejected: number;
  write_accepted: number;
  write_rejected: number;
  notebook_accepted: number;
  notebook_rejected: number;
  last_date: string;
}

export interface PerUserModelRow {
  user_id: number;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_cents: number;
}

export interface HourlyTokenRow {
  user_id: number;
  hour_utc: string;
  tokens: number;
}

export interface UserDateRow {
  user_id: number;
  date: string;
}

export interface UserDaySessionsRow {
  user_id: number;
  date: string;
  sessions: number;
}

export interface CalendarRow {
  date: string;
  sessions: number;
  net_lines: number;
}

export interface TimeseriesRow {
  date: string;
  key: string | null;
  sessions: number;
  lines_added: number;
  lines_removed: number;
  commits: number;
  pull_requests: number;
  tool_accepted: number;
  tool_rejected: number;
  cost_cents: number;
}

export interface HeatmapRow {
  hour_utc: string;
  tokens: number;
  active_users: number;
}

export interface DailyInsertRow {
  date: string;
  userId: number;
  terminalType: string;
  customerType: string;
  numSessions: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  editAccepted: number;
  editRejected: number;
  multiEditAccepted: number;
  multiEditRejected: number;
  writeAccepted: number;
  writeRejected: number;
  notebookAccepted: number;
  notebookRejected: number;
  rawJson: string;
  models: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costCents: number;
  }>;
}

export interface HourlyUpsertRow {
  userId: number;
  hourUtc: string;
  uncachedInputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  webSearchRequests: number;
}

/** Additive per-day counter deltas (telemetry ingest) — raw_json stays '{}'. */
export type DailyDeltaRow = Omit<DailyInsertRow, 'rawJson' | 'models'>;

/** Additive per-model token/cost deltas onto a (date,user,terminal,customer) parent. */
export interface ModelDeltaRow {
  date: string;
  userId: number;
  terminalType: string;
  customerType: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costCents: number;
}

export type Granularity = 'day' | 'week' | 'month';

/** Bucket-start expression per granularity; weeks start Sunday (Israeli convention). */
const BUCKET_EXPR: Record<Granularity, string> = {
  day: 'd.date',
  week: `date(d.date, '-' || strftime('%w', d.date) || ' days')`,
  month: `date(d.date, 'start of month')`,
};

const ACCEPTED_SUM = '(d.edit_accepted + d.multi_edit_accepted + d.write_accepted + d.notebook_accepted)';
const REJECTED_SUM = '(d.edit_rejected + d.multi_edit_rejected + d.write_rejected + d.notebook_rejected)';
const HOURLY_TOKENS_SUM =
  '(h.uncached_input_tokens + h.cache_creation_tokens + h.cache_read_tokens + h.output_tokens)';

export class UsageRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Overview aggregates
  // -------------------------------------------------------------------------

  /** People metrics over user-actors only. */
  peopleKpis(from: string, to: string, teamId?: number): PeopleKpiRow {
    const teamFilter = teamId === undefined ? '' : 'AND u.team_id = @teamId';
    return this.db
      .prepare(
        `SELECT
           COALESCE(SUM(d.num_sessions), 0) AS sessions,
           COALESCE(SUM(d.lines_added), 0) AS lines_added,
           COALESCE(SUM(d.lines_removed), 0) AS lines_removed,
           COALESCE(SUM(d.commits), 0) AS commits,
           COALESCE(SUM(d.pull_requests), 0) AS pull_requests,
           COALESCE(SUM(${ACCEPTED_SUM}), 0) AS accepted,
           COALESCE(SUM(${REJECTED_SUM}), 0) AS rejected,
           COUNT(DISTINCT CASE WHEN d.num_sessions > 0 THEN d.user_id END) AS active_users,
           COUNT(DISTINCT CASE WHEN d.num_sessions > 0 AND u.in_roster = 1 THEN d.user_id END) AS active_rostered
         FROM usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to AND u.actor_type = 'user' ${teamFilter}`,
      )
      .get({ from, to, teamId }) as PeopleKpiRow;
  }

  /** Token + cost totals over ALL actors (api_key spend counts). */
  tokenCostTotals(from: string, to: string, teamId?: number): TokenCostRow {
    const teamFilter = teamId === undefined ? '' : 'AND u.team_id = @teamId';
    return this.db
      .prepare(
        `SELECT
           COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
           COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
           COALESCE(SUM(m.cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(m.cache_creation_tokens), 0) AS cache_creation_tokens,
           COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to ${teamFilter}`,
      )
      .get({ from, to, teamId }) as TokenCostRow;
  }

  /**
   * Core people metrics grouped by day/week/month bucket (date = bucket start).
   * active_users is COUNT(DISTINCT user) WITHIN the bucket — not derivable
   * from per-day counts client-side.
   */
  dailyCore(from: string, to: string, teamId?: number, gran: Granularity = 'day'): DailyCoreRow[] {
    const teamFilter = teamId === undefined ? '' : 'AND u.team_id = @teamId';
    const bucket = BUCKET_EXPR[gran];
    return this.db
      .prepare(
        `SELECT
           ${bucket} AS date,
           COALESCE(SUM(d.num_sessions), 0) AS sessions,
           COUNT(DISTINCT CASE WHEN d.num_sessions > 0 THEN d.user_id END) AS active_users,
           COALESCE(SUM(d.lines_added), 0) AS lines_added,
           COALESCE(SUM(d.lines_removed), 0) AS lines_removed,
           COALESCE(SUM(d.commits), 0) AS commits,
           COALESCE(SUM(d.pull_requests), 0) AS pull_requests
         FROM usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to AND u.actor_type = 'user' ${teamFilter}
         GROUP BY ${bucket}`,
      )
      .all({ from, to, teamId }) as DailyCoreRow[];
  }

  dailyCost(from: string, to: string, teamId?: number, gran: Granularity = 'day'): DailyCostRow[] {
    const teamFilter = teamId === undefined ? '' : 'AND u.team_id = @teamId';
    const bucket = BUCKET_EXPR[gran];
    return this.db
      .prepare(
        `SELECT ${bucket} AS date, COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to ${teamFilter}
         GROUP BY ${bucket}`,
      )
      .all({ from, to, teamId }) as DailyCostRow[];
  }

  modelTotals(from: string, to: string, teamId?: number, userId?: number): ModelTotalsRow[] {
    const teamFilter = teamId === undefined ? '' : 'AND u.team_id = @teamId';
    const userFilter = userId === undefined ? '' : 'AND d.user_id = @userId';
    return this.db
      .prepare(
        `SELECT
           m.model AS model,
           COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
           COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
           COALESCE(SUM(m.cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(m.cache_creation_tokens), 0) AS cache_creation_tokens,
           COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to ${teamFilter} ${userFilter}
         GROUP BY m.model
         ORDER BY cost_cents DESC`,
      )
      .all({ from, to, teamId, userId }) as ModelTotalsRow[];
  }

  modelDailyCost(from: string, to: string, teamId?: number): ModelDailyCostRow[] {
    const teamFilter = teamId === undefined ? '' : 'AND u.team_id = @teamId';
    return this.db
      .prepare(
        `SELECT d.date AS date, m.model AS model, COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to ${teamFilter}
         GROUP BY d.date, m.model
         ORDER BY d.date, m.model`,
      )
      .all({ from, to, teamId }) as ModelDailyCostRow[];
  }

  terminalMix(from: string, to: string, opts: { teamId?: number; userId?: number } = {}): TerminalMixRow[] {
    const teamFilter = opts.teamId === undefined ? '' : 'AND u.team_id = @teamId';
    // org-level mix is a people metric (user actors); a specific userId may be any actor
    const userFilter = opts.userId === undefined ? "AND u.actor_type = 'user'" : 'AND d.user_id = @userId';
    return this.db
      .prepare(
        `SELECT d.terminal_type AS terminal_type, COALESCE(SUM(d.num_sessions), 0) AS sessions
         FROM usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN @from AND @to ${teamFilter} ${userFilter}
         GROUP BY d.terminal_type
         ORDER BY sessions DESC`,
      )
      .all({ from, to, teamId: opts.teamId, userId: opts.userId }) as TerminalMixRow[];
  }

  // -------------------------------------------------------------------------
  // Per-user aggregates for scoring
  // -------------------------------------------------------------------------

  perUserDaily(from: string, to: string): PerUserDailyRow[] {
    return this.db
      .prepare(
        `SELECT
           d.user_id AS user_id,
           COALESCE(SUM(d.num_sessions), 0) AS sessions,
           COUNT(DISTINCT d.date) AS active_days,
           COALESCE(SUM(d.lines_added), 0) AS lines_added,
           COALESCE(SUM(d.lines_removed), 0) AS lines_removed,
           COALESCE(SUM(d.commits), 0) AS commits,
           COALESCE(SUM(d.pull_requests), 0) AS pull_requests,
           COALESCE(SUM(d.edit_accepted), 0) AS edit_accepted,
           COALESCE(SUM(d.edit_rejected), 0) AS edit_rejected,
           COALESCE(SUM(d.multi_edit_accepted), 0) AS multi_edit_accepted,
           COALESCE(SUM(d.multi_edit_rejected), 0) AS multi_edit_rejected,
           COALESCE(SUM(d.write_accepted), 0) AS write_accepted,
           COALESCE(SUM(d.write_rejected), 0) AS write_rejected,
           COALESCE(SUM(d.notebook_accepted), 0) AS notebook_accepted,
           COALESCE(SUM(d.notebook_rejected), 0) AS notebook_rejected,
           MAX(d.date) AS last_date
         FROM usage_daily d
         WHERE d.date BETWEEN ? AND ?
         GROUP BY d.user_id`,
      )
      .all(from, to) as PerUserDailyRow[];
  }

  perUserModels(from: string, to: string): PerUserModelRow[] {
    return this.db
      .prepare(
        `SELECT
           d.user_id AS user_id,
           m.model AS model,
           COALESCE(SUM(m.input_tokens), 0) AS input_tokens,
           COALESCE(SUM(m.output_tokens), 0) AS output_tokens,
           COALESCE(SUM(m.cache_read_tokens), 0) AS cache_read_tokens,
           COALESCE(SUM(m.cache_creation_tokens), 0) AS cache_creation_tokens,
           COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         WHERE d.date BETWEEN ? AND ?
         GROUP BY d.user_id, m.model`,
      )
      .all(from, to) as PerUserModelRow[];
  }

  /** Hourly token activity per user per hour (rows are already unique per user+hour). */
  hourlyTokens(from: string, to: string): HourlyTokenRow[] {
    const { fromHour, toHour } = utcHourRangeOfLocalDays(from, to, orgTimezone());
    return this.db
      .prepare(
        `SELECT h.user_id AS user_id, h.hour_utc AS hour_utc, ${HOURLY_TOKENS_SUM} AS tokens
         FROM usage_hourly h
         WHERE h.hour_utc >= ? AND h.hour_utc <= ?`,
      )
      .all(fromHour, toHour) as HourlyTokenRow[];
  }

  /**
   * Impact-term coverage over [from, to] (callers pass a trailing-90d window):
   * how many user-actors were active at all, and how many of those produced
   * any PRs / commits. Feeds the coverage-gated Impact weights — a stable org
   * fact, deliberately independent of the user-selected range.
   */
  impactCoverage(from: string, to: string): { activeUsers: number; usersWithPrs: number; usersWithCommits: number } {
    return this.db
      .prepare(
        `SELECT
           COUNT(DISTINCT CASE WHEN d.num_sessions > 0 THEN d.user_id END) AS activeUsers,
           COUNT(DISTINCT CASE WHEN d.pull_requests > 0 THEN d.user_id END) AS usersWithPrs,
           COUNT(DISTINCT CASE WHEN d.commits > 0 THEN d.user_id END) AS usersWithCommits
         FROM usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN ? AND ? AND u.actor_type = 'user'`,
      )
      .get(from, to) as { activeUsers: number; usersWithPrs: number; usersWithCommits: number };
  }

  /** Distinct active dates per user in [from, to] (any usage row). */
  activeDates(from: string, to: string): UserDateRow[] {
    return this.db
      .prepare(`SELECT DISTINCT user_id, date FROM usage_daily WHERE date BETWEEN ? AND ?`)
      .all(from, to) as UserDateRow[];
  }

  sessionsByUserDay(from: string, to: string): UserDaySessionsRow[] {
    return this.db
      .prepare(
        `SELECT user_id, date, COALESCE(SUM(num_sessions), 0) AS sessions
         FROM usage_daily
         WHERE date BETWEEN ? AND ?
         GROUP BY user_id, date`,
      )
      .all(from, to) as UserDaySessionsRow[];
  }

  /** All-time last active date per user (for daysIdle). */
  globalLastActiveDates(): Array<{ user_id: number; last_date: string }> {
    return this.db
      .prepare(`SELECT user_id, MAX(date) AS last_date FROM usage_daily GROUP BY user_id`)
      .all() as Array<{ user_id: number; last_date: string }>;
  }

  /**
   * Most recent activity instant for one user, best precision available:
   * telemetry session end times are exact; hourly buckets ('…THH:00:00Z')
   * give the hour. All three are ISO UTC strings, so MAX() compares correctly.
   * null when the user only has daily rows.
   */
  lastActiveAt(userId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(ts) AS ts FROM (
           SELECT MAX(last_event_at) AS ts FROM otel_sessions WHERE user_id = @userId
           UNION ALL SELECT MAX(hour_utc) FROM otel_activity_hourly WHERE user_id = @userId
           UNION ALL SELECT MAX(hour_utc) FROM usage_hourly WHERE user_id = @userId
         )`,
      )
      .get({ userId }) as { ts: string | null } | undefined;
    return row?.ts ?? null;
  }

  // -------------------------------------------------------------------------
  // Profile / timeseries / heatmap
  // -------------------------------------------------------------------------

  calendarCore(userId: number, from: string, to: string): CalendarRow[] {
    return this.db
      .prepare(
        `SELECT date, COALESCE(SUM(num_sessions), 0) AS sessions,
                COALESCE(SUM(lines_added - lines_removed), 0) AS net_lines
         FROM usage_daily
         WHERE user_id = ? AND date BETWEEN ? AND ?
         GROUP BY date`,
      )
      .all(userId, from, to) as CalendarRow[];
  }

  calendarCost(userId: number, from: string, to: string): DailyCostRow[] {
    return this.db
      .prepare(
        `SELECT d.date AS date, COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         WHERE d.user_id = ? AND d.date BETWEEN ? AND ?
         GROUP BY d.date`,
      )
      .all(userId, from, to) as DailyCostRow[];
  }

  /** Per-day token/cost totals for one user (all models summed) — the profile's cost & cache trend. */
  tokensDaily(userId: number, from: string, to: string): Array<TokenCostRow & { date: string }> {
    return this.db
      .prepare(
        `SELECT d.date AS date,
                COALESCE(SUM(m.input_tokens), 0)          AS input_tokens,
                COALESCE(SUM(m.output_tokens), 0)         AS output_tokens,
                COALESCE(SUM(m.cache_read_tokens), 0)     AS cache_read_tokens,
                COALESCE(SUM(m.cache_creation_tokens), 0) AS cache_creation_tokens,
                COALESCE(SUM(m.cost_cents), 0)            AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         WHERE d.user_id = @userId AND d.date BETWEEN @from AND @to
         GROUP BY d.date
         ORDER BY d.date`,
      )
      .all({ userId, from, to }) as Array<TokenCostRow & { date: string }>;
  }

  timeseries(userId: number, from: string, to: string, split: 'none' | 'terminal'): TimeseriesRow[] {
    const keyExpr = split === 'terminal' ? 'd.terminal_type' : 'NULL';
    const groupBy = split === 'terminal' ? 'd.date, d.terminal_type' : 'd.date';
    return this.db
      .prepare(
        `SELECT
           d.date AS date,
           ${keyExpr} AS key,
           COALESCE(SUM(d.num_sessions), 0) AS sessions,
           COALESCE(SUM(d.lines_added), 0) AS lines_added,
           COALESCE(SUM(d.lines_removed), 0) AS lines_removed,
           COALESCE(SUM(d.commits), 0) AS commits,
           COALESCE(SUM(d.pull_requests), 0) AS pull_requests,
           COALESCE(SUM(${ACCEPTED_SUM}), 0) AS tool_accepted,
           COALESCE(SUM(${REJECTED_SUM}), 0) AS tool_rejected,
           COALESCE((
             SELECT SUM(m.cost_cents)
             FROM usage_daily_models m
             JOIN usage_daily d2 ON d2.id = m.usage_daily_id
             WHERE d2.user_id = d.user_id AND d2.date = d.date
               ${split === 'terminal' ? 'AND d2.terminal_type = d.terminal_type' : ''}
           ), 0) AS cost_cents
         FROM usage_daily d
         WHERE d.user_id = @userId AND d.date BETWEEN @from AND @to
         GROUP BY ${groupBy}
         ORDER BY d.date, key`,
      )
      .all({ userId, from, to }) as TimeseriesRow[];
  }

  /** Model split: only cost is attributable per model; core metrics have no model grain. */
  timeseriesByModel(userId: number, from: string, to: string): TimeseriesRow[] {
    return this.db
      .prepare(
        `SELECT
           d.date AS date,
           m.model AS key,
           0 AS sessions, 0 AS lines_added, 0 AS lines_removed, 0 AS commits, 0 AS pull_requests,
           0 AS tool_accepted, 0 AS tool_rejected,
           COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         WHERE d.user_id = ? AND d.date BETWEEN ? AND ?
         GROUP BY d.date, m.model
         ORDER BY d.date, m.model`,
      )
      .all(userId, from, to) as TimeseriesRow[];
  }

  heatmap(from: string, to: string, opts: { teamId?: number; userId?: number } = {}): HeatmapRow[] {
    const teamFilter = opts.teamId === undefined ? '' : 'AND u.team_id = @teamId';
    const userFilter = opts.userId === undefined ? '' : 'AND h.user_id = @userId';
    return this.db
      .prepare(
        `SELECT
           h.hour_utc AS hour_utc,
           COALESCE(SUM(${HOURLY_TOKENS_SUM}), 0) AS tokens,
           COUNT(DISTINCT h.user_id) AS active_users
         FROM usage_hourly h
         JOIN users u ON u.id = h.user_id
         WHERE h.hour_utc >= @fromHour AND h.hour_utc <= @toHour ${teamFilter} ${userFilter}
         GROUP BY h.hour_utc
         ORDER BY h.hour_utc`,
      )
      .all({
        ...utcHourRangeOfLocalDays(from, to, orgTimezone()),
        teamId: opts.teamId,
        userId: opts.userId,
      }) as HeatmapRow[];
  }

  // -------------------------------------------------------------------------
  // Adoption (rolling actives + org-wide calendar)
  // -------------------------------------------------------------------------

  /** Distinct (user, date) pairs where a USER actor had sessions that day. */
  userActiveDays(from: string, to: string): UserDateRow[] {
    return this.db
      .prepare(
        `SELECT DISTINCT d.user_id AS user_id, d.date AS date
         FROM usage_daily d
         JOIN users u ON u.id = d.user_id
         WHERE d.date BETWEEN ? AND ? AND u.actor_type = 'user' AND d.num_sessions > 0`,
      )
      .all(from, to) as UserDateRow[];
  }

  /** Profile-calendar core aggregate without the user filter (org-wide, all actors). */
  orgCalendarCore(from: string, to: string): CalendarRow[] {
    return this.db
      .prepare(
        `SELECT date, COALESCE(SUM(num_sessions), 0) AS sessions,
                COALESCE(SUM(lines_added - lines_removed), 0) AS net_lines
         FROM usage_daily
         WHERE date BETWEEN ? AND ?
         GROUP BY date`,
      )
      .all(from, to) as CalendarRow[];
  }

  /** Profile-calendar cost aggregate without the user filter (org-wide, all actors). */
  orgCalendarCost(from: string, to: string): DailyCostRow[] {
    return this.db
      .prepare(
        `SELECT d.date AS date, COALESCE(SUM(m.cost_cents), 0) AS cost_cents
         FROM usage_daily_models m
         JOIN usage_daily d ON d.id = m.usage_daily_id
         WHERE d.date BETWEEN ? AND ?
         GROUP BY d.date`,
      )
      .all(from, to) as DailyCostRow[];
  }

  // -------------------------------------------------------------------------
  // Sync writes
  // -------------------------------------------------------------------------

  /** Replace one UTC day atomically. Returns number of usage_daily rows written. */
  replaceDay(date: string, rows: DailyInsertRow[], touchSeen: (userId: number, date: string) => void): number {
    const deleteDay = this.db.prepare(`DELETE FROM usage_daily WHERE date = ?`);
    const insertDaily = this.db.prepare(
      `INSERT INTO usage_daily (
         date, user_id, terminal_type, customer_type, num_sessions,
         lines_added, lines_removed, commits, pull_requests,
         edit_accepted, edit_rejected, multi_edit_accepted, multi_edit_rejected,
         write_accepted, write_rejected, notebook_accepted, notebook_rejected, raw_json
       ) VALUES (
         @date, @userId, @terminalType, @customerType, @numSessions,
         @linesAdded, @linesRemoved, @commits, @pullRequests,
         @editAccepted, @editRejected, @multiEditAccepted, @multiEditRejected,
         @writeAccepted, @writeRejected, @notebookAccepted, @notebookRejected, @rawJson
       )`,
    );
    const insertModel = this.db.prepare(
      `INSERT INTO usage_daily_models (
         usage_daily_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const txn = this.db.transaction((dayRows: DailyInsertRow[]) => {
      deleteDay.run(date);
      for (const row of dayRows) {
        const res = insertDaily.run({
          date: row.date,
          userId: row.userId,
          terminalType: row.terminalType,
          customerType: row.customerType,
          numSessions: row.numSessions,
          linesAdded: row.linesAdded,
          linesRemoved: row.linesRemoved,
          commits: row.commits,
          pullRequests: row.pullRequests,
          editAccepted: row.editAccepted,
          editRejected: row.editRejected,
          multiEditAccepted: row.multiEditAccepted,
          multiEditRejected: row.multiEditRejected,
          writeAccepted: row.writeAccepted,
          writeRejected: row.writeRejected,
          notebookAccepted: row.notebookAccepted,
          notebookRejected: row.notebookRejected,
          rawJson: row.rawJson,
        });
        const dailyId = Number(res.lastInsertRowid);
        for (const m of row.models) {
          insertModel.run(
            dailyId,
            m.model,
            m.inputTokens,
            m.outputTokens,
            m.cacheReadTokens,
            m.cacheCreationTokens,
            m.costCents,
          );
        }
        touchSeen(row.userId, row.date);
      }
      return dayRows.length;
    });
    return txn(rows);
  }

  /**
   * Enterprise intraday: refresh usage_daily_models for one day WITHOUT
   * touching engagement metrics (which lag days behind token usage). Each
   * entry finds its parent usage_daily row keyed (date, user, '', customerType)
   * — creating a zero-metrics parent when engagement hasn't landed yet — then
   * replaces that parent's model children. One transaction for the whole day.
   * Returns model rows written.
   */
  upsertModelsOnly(
    date: string,
    entries: Array<{ userId: number; customerType: string; models: DailyInsertRow['models'] }>,
    touchSeen: (userId: number, date: string) => void,
  ): number {
    const findParent = this.db.prepare(
      `SELECT id FROM usage_daily
       WHERE date = ? AND user_id = ? AND terminal_type = '' AND customer_type = ?`,
    );
    const insertParent = this.db.prepare(
      `INSERT INTO usage_daily (date, user_id, terminal_type, customer_type, raw_json)
       VALUES (?, ?, '', ?, '{}')`,
    );
    const deleteModels = this.db.prepare(`DELETE FROM usage_daily_models WHERE usage_daily_id = ?`);
    const insertModel = this.db.prepare(
      `INSERT INTO usage_daily_models (
         usage_daily_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const txn = this.db.transaction((batch: typeof entries) => {
      let written = 0;
      for (const entry of batch) {
        const existing = findParent.get(date, entry.userId, entry.customerType) as { id: number } | undefined;
        const parentId = existing
          ? existing.id
          : Number(insertParent.run(date, entry.userId, entry.customerType).lastInsertRowid);
        deleteModels.run(parentId);
        for (const m of entry.models) {
          insertModel.run(
            parentId,
            m.model,
            m.inputTokens,
            m.outputTokens,
            m.cacheReadTokens,
            m.cacheCreationTokens,
            m.costCents,
          );
          written += 1;
        }
        touchSeen(entry.userId, date);
      }
      return written;
    });
    return txn(entries);
  }

  upsertHourly(rows: HourlyUpsertRow[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO usage_hourly (
         user_id, hour_utc, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
         web_search_requests
       ) VALUES (@userId, @hourUtc, @uncachedInputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens,
                 @webSearchRequests)
       ON CONFLICT (user_id, hour_utc) DO UPDATE SET
         uncached_input_tokens = excluded.uncached_input_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens,
         cache_read_tokens     = excluded.cache_read_tokens,
         output_tokens         = excluded.output_tokens,
         web_search_requests   = excluded.web_search_requests`,
    );
    const txn = this.db.transaction((batch: HourlyUpsertRow[]) => {
      for (const row of batch) upsert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  // -------------------------------------------------------------------------
  // Telemetry ingest writes — ADDITIVE deltas, unlike the replace-semantics
  // sync methods above (OTLP batches arrive incrementally, not as full days).
  // -------------------------------------------------------------------------

  /** Increment every usage_daily counter for each (date,user,terminal,customer). */
  upsertDailyDeltas(rows: DailyDeltaRow[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO usage_daily (
         date, user_id, terminal_type, customer_type, num_sessions,
         lines_added, lines_removed, commits, pull_requests,
         edit_accepted, edit_rejected, multi_edit_accepted, multi_edit_rejected,
         write_accepted, write_rejected, notebook_accepted, notebook_rejected, raw_json
       ) VALUES (
         @date, @userId, @terminalType, @customerType, @numSessions,
         @linesAdded, @linesRemoved, @commits, @pullRequests,
         @editAccepted, @editRejected, @multiEditAccepted, @multiEditRejected,
         @writeAccepted, @writeRejected, @notebookAccepted, @notebookRejected, '{}'
       )
       ON CONFLICT (date, user_id, terminal_type, customer_type) DO UPDATE SET
         num_sessions        = num_sessions + excluded.num_sessions,
         lines_added         = lines_added + excluded.lines_added,
         lines_removed       = lines_removed + excluded.lines_removed,
         commits             = commits + excluded.commits,
         pull_requests       = pull_requests + excluded.pull_requests,
         edit_accepted       = edit_accepted + excluded.edit_accepted,
         edit_rejected       = edit_rejected + excluded.edit_rejected,
         multi_edit_accepted = multi_edit_accepted + excluded.multi_edit_accepted,
         multi_edit_rejected = multi_edit_rejected + excluded.multi_edit_rejected,
         write_accepted      = write_accepted + excluded.write_accepted,
         write_rejected      = write_rejected + excluded.write_rejected,
         notebook_accepted   = notebook_accepted + excluded.notebook_accepted,
         notebook_rejected   = notebook_rejected + excluded.notebook_rejected`,
    );
    const txn = this.db.transaction((batch: DailyDeltaRow[]) => {
      for (const row of batch) upsert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  /** Add token/cost deltas onto usage_hourly buckets (web_search_requests included). */
  upsertHourlyDeltas(rows: HourlyUpsertRow[]): number {
    const upsert = this.db.prepare(
      `INSERT INTO usage_hourly (
         user_id, hour_utc, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
         web_search_requests
       ) VALUES (@userId, @hourUtc, @uncachedInputTokens, @cacheCreationTokens, @cacheReadTokens, @outputTokens,
                 @webSearchRequests)
       ON CONFLICT (user_id, hour_utc) DO UPDATE SET
         uncached_input_tokens = uncached_input_tokens + excluded.uncached_input_tokens,
         cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
         cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
         output_tokens         = output_tokens + excluded.output_tokens,
         web_search_requests   = web_search_requests + excluded.web_search_requests`,
    );
    const txn = this.db.transaction((batch: HourlyUpsertRow[]) => {
      for (const row of batch) upsert.run(row);
      return batch.length;
    });
    return txn(rows);
  }

  /**
   * Add per-model token/cost deltas: find-or-create the parent usage_daily row
   * (zero metrics, raw_json '{}'), then increment the (parent, model) child —
   * relies on ux_udm_parent_model from migration 006.
   */
  upsertModelDeltas(rows: ModelDeltaRow[]): number {
    const findParent = this.db.prepare(
      `SELECT id FROM usage_daily
       WHERE date = ? AND user_id = ? AND terminal_type = ? AND customer_type = ?`,
    );
    const insertParent = this.db.prepare(
      `INSERT INTO usage_daily (date, user_id, terminal_type, customer_type, raw_json)
       VALUES (?, ?, ?, ?, '{}')`,
    );
    const upsertModel = this.db.prepare(
      `INSERT INTO usage_daily_models (
         usage_daily_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (usage_daily_id, model) DO UPDATE SET
         input_tokens          = input_tokens + excluded.input_tokens,
         output_tokens         = output_tokens + excluded.output_tokens,
         cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
         cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
         cost_cents            = cost_cents + excluded.cost_cents`,
    );
    const txn = this.db.transaction((batch: ModelDeltaRow[]) => {
      for (const row of batch) {
        const existing = findParent.get(row.date, row.userId, row.terminalType, row.customerType) as
          | { id: number }
          | undefined;
        const parentId = existing
          ? existing.id
          : Number(insertParent.run(row.date, row.userId, row.terminalType, row.customerType).lastInsertRowid);
        upsertModel.run(
          parentId,
          row.model,
          row.inputTokens,
          row.outputTokens,
          row.cacheReadTokens,
          row.cacheCreationTokens,
          row.costCents,
        );
      }
      return batch.length;
    });
    return txn(rows);
  }
}
