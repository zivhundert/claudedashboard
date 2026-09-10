import type { Db } from '../db/connection';

/** Ingest replay-protection window — exporter retries land well within this. */
export const DEDUP_RETENTION_MS = 15 * 60_000;

// ---------------------------------------------------------------------------
// Ingest deltas — one entry per (date, user, entity) in an OTLP batch; every
// counter is an increment applied on top of whatever the row already holds.
// ---------------------------------------------------------------------------

export interface SkillDelta {
  date: string;
  userId: number;
  skillName: string;
  invocations: number;
  userSlash: number;
  proactive: number;
  nested: number;
  costCents: number;
}

/** Static facts about a skill seen in this batch (attrs of skill_activated). */
export interface SkillMetaDelta {
  skillName: string;
  source: string | null;
  kind: string | null;
  pluginName: string | null;
  marketplaceName: string | null;
  /** full ISO of the latest event carrying these facts */
  seenAt: string;
}

export interface AgentDelta {
  date: string;
  userId: number;
  subagentType: string;
  invocations: number;
  success: number;
  failure: number;
  costCents: number;
}

export interface ToolDelta {
  date: string;
  userId: number;
  toolName: string;
  uses: number;
  success: number;
  failure: number;
  accepted: number;
  rejected: number;
}

export interface ReliabilityDelta {
  date: string;
  userId: number;
  /** '' when the event carried no model attribute */
  model: string;
  apiRequests: number;
  apiErrors: number;
  errors429: number;
  errors5xx: number;
  errorsOther: number;
  refusals: number;
  compactions: number;
  internalErrors: number;
  totalDurationMs: number;
}

export interface GovernanceDelta {
  date: string;
  userId: number;
  srcConfig: number;
  srcHook: number;
  srcUserPermanent: number;
  srcUserTemporary: number;
  srcUserAbort: number;
  srcUserReject: number;
  permissionModeChanges: number;
}

export interface PermissionModeDelta {
  date: string;
  userId: number;
  mode: string;
  changes: number;
}

export interface PluginDelta {
  date: string;
  userId: number;
  pluginName: string;
  installs: number;
  loads: number;
}

/** One observed session in a batch — merged into otel_sessions on ingest. */
export interface SessionDelta {
  sessionId: string;
  userId: number;
  /** date of the earliest event seen in this batch */
  date: string;
  firstEventAt: string;
  lastEventAt: string;
  events: number;
  prompts: number;
}

export interface OtelIngestBatch {
  skills: SkillDelta[];
  skillMeta: SkillMetaDelta[];
  agents: AgentDelta[];
  tools: ToolDelta[];
  activityDaily: ActivityDailyDelta[];
  activityHourly: ActivityHourlyDelta[];
  reliability: ReliabilityDelta[];
  governance: GovernanceDelta[];
  permissionModes: PermissionModeDelta[];
  mcp: McpDailyDelta[];
  plugins: PluginDelta[];
  sessions: SessionDelta[];
  /** relevant events processed / dropped (no resolvable user.email) */
  eventsIngested: number;
  eventsDropped: number;
  /** max event time in the batch, full ISO */
  maxEventAt: string | null;
}

// --- Metrics-ingest pack-table deltas (written in EVERY data-source mode) ---

export interface ActivityDailyDelta {
  date: string;
  userId: number;
  activeUserS: number;
  activeCliS: number;
  prompts: number;
  sessions: number;
}

export interface ActivityHourlyDelta {
  userId: number;
  hourUtc: string;
  prompts: number;
  apiRequests: number;
  sessionsStarted: number;
}

export interface McpDailyDelta {
  date: string;
  userId: number;
  serverName: string;
  toolCalls: number;
  toolFailures: number;
  tokens: number;
  costCents: number;
  connections: number;
  connectionFailures: number;
}

export interface TokenMixDelta {
  date: string;
  userId: number;
  model: string;
  speed: string;
  effort: string;
  tokens: number;
  costCents: number;
}

// ---------------------------------------------------------------------------
// Query row shapes (snake_case straight from SQLite)
// ---------------------------------------------------------------------------

export interface SkillTotalsRow {
  skill_name: string;
  invocations: number;
  users: number;
  cost_cents: number;
  user_slash: number;
  proactive: number;
  nested: number;
}

export interface AgentTotalsRow {
  subagent_type: string;
  invocations: number;
  users: number;
  success: number;
  failure: number;
  cost_cents: number;
}

export interface ToolTotalsRow {
  tool_name: string;
  uses: number;
  success: number;
  failure: number;
  accepted: number;
  rejected: number;
}

export interface McpToolTotalsRow extends ToolTotalsRow {
  users: number;
}

export interface UserRollupRow {
  user_id: number;
  name: string;
  email: string | null;
  skill_invocations: number;
  distinct_skills: number;
  agent_invocations: number;
  top_skill: string | null;
}

/** One user's activity-event count for one UTC hour bucket. */
export interface HourlyActivityRow {
  user_id: number;
  hour_utc: string;
  events: number;
}

/** Per-user aggregates powering the value-delivery badges. Field names match ScoringInput. */
export interface UserBadgeStats {
  skillInvocations: number;
  distinctSkills: number;
  mcpCalls: number;
  mcpFailures: number;
  activeMcpServers: number;
  subagentRuns: number;
  subagentSuccesses: number;
  distinctAgentTypes: number;
  planModeEntries: number;
  plansAccepted: number;
  /** all-time compactions (deliberately NOT range-scoped — see deep_diver) */
  compactions: number;
}

export const EMPTY_BADGE_STATS: UserBadgeStats = {
  skillInvocations: 0,
  distinctSkills: 0,
  mcpCalls: 0,
  mcpFailures: 0,
  activeMcpServers: 0,
  subagentRuns: 0,
  subagentSuccesses: 0,
  distinctAgentTypes: 0,
  planModeEntries: 0,
  plansAccepted: 0,
  compactions: 0,
};

export interface OtelTotals {
  skillInvocations: number;
  distinctSkills: number;
  agentInvocations: number;
  activeSkillUsers: number;
  skillCostCents: number;
  agentCostCents: number;
}

/** Optional scoping — userId narrows to one person, teamId via users.team_id. */
export interface OtelScope {
  teamId?: number;
  userId?: number;
}

export interface ScopeParams {
  from: string;
  to: string;
  teamId?: number;
  userId?: number;
  [key: string]: unknown;
}

/**
 * `t` is the aggregate table alias; the users join is only added when a team
 * filter needs it, keeping the common unscoped path index-only on (date).
 */
export function scopeSql(table: string, scope: OtelScope): { fromSql: string; whereSql: string } {
  const joins = scope.teamId !== undefined ? ` JOIN users u ON u.id = t.user_id` : '';
  let where = `t.date BETWEEN @from AND @to`;
  if (scope.teamId !== undefined) where += ` AND u.team_id = @teamId`;
  if (scope.userId !== undefined) where += ` AND t.user_id = @userId`;
  return { fromSql: `${table} t${joins}`, whereSql: where };
}

export function scopeParams(from: string, to: string, scope: OtelScope): ScopeParams {
  const params: ScopeParams = { from, to };
  if (scope.teamId !== undefined) params.teamId = scope.teamId;
  if (scope.userId !== undefined) params.userId = scope.userId;
  return params;
}

export class OtelRepo {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Ingest — one transaction: counter upserts + sync_state bookkeeping
  // -------------------------------------------------------------------------

  ingest(batch: OtelIngestBatch, dedupHash?: string): boolean {
    const upsertSkill = this.db.prepare(
      `INSERT INTO otel_skill_daily (date, user_id, skill_name, invocations, user_slash, proactive, nested, cost_cents)
       VALUES (@date, @userId, @skillName, @invocations, @userSlash, @proactive, @nested, @costCents)
       ON CONFLICT (date, user_id, skill_name) DO UPDATE SET
         invocations = invocations + excluded.invocations,
         user_slash  = user_slash + excluded.user_slash,
         proactive   = proactive + excluded.proactive,
         nested      = nested + excluded.nested,
         cost_cents  = cost_cents + excluded.cost_cents`,
    );
    const upsertAgent = this.db.prepare(
      `INSERT INTO otel_agent_daily (date, user_id, subagent_type, invocations, success, failure, cost_cents)
       VALUES (@date, @userId, @subagentType, @invocations, @success, @failure, @costCents)
       ON CONFLICT (date, user_id, subagent_type) DO UPDATE SET
         invocations = invocations + excluded.invocations,
         success     = success + excluded.success,
         failure     = failure + excluded.failure,
         cost_cents  = cost_cents + excluded.cost_cents`,
    );
    const upsertTool = this.db.prepare(
      `INSERT INTO otel_tool_daily (date, user_id, tool_name, uses, success, failure, accepted, rejected)
       VALUES (@date, @userId, @toolName, @uses, @success, @failure, @accepted, @rejected)
       ON CONFLICT (date, user_id, tool_name) DO UPDATE SET
         uses     = uses + excluded.uses,
         success  = success + excluded.success,
         failure  = failure + excluded.failure,
         accepted = accepted + excluded.accepted,
         rejected = rejected + excluded.rejected`,
    );

    const upsertSkillMeta = this.db.prepare(
      `INSERT INTO otel_skill_meta (skill_name, source, kind, plugin_name, marketplace_name, first_seen_at, last_seen_at)
       VALUES (@skillName, @source, @kind, @pluginName, @marketplaceName, @seenAt, @seenAt)
       ON CONFLICT (skill_name) DO UPDATE SET
         source           = COALESCE(excluded.source, source),
         kind             = COALESCE(excluded.kind, kind),
         plugin_name      = COALESCE(excluded.plugin_name, plugin_name),
         marketplace_name = COALESCE(excluded.marketplace_name, marketplace_name),
         first_seen_at    = MIN(first_seen_at, excluded.first_seen_at),
         last_seen_at     = MAX(last_seen_at, excluded.last_seen_at)`,
    );

    const txn = this.db.transaction((b: OtelIngestBatch): boolean => {
      if (dedupHash !== undefined && !this.tryMarkIngest(dedupHash)) return false;
      for (const row of b.skills) upsertSkill.run(row);
      for (const row of b.skillMeta) upsertSkillMeta.run(row);
      for (const row of b.agents) upsertAgent.run(row);
      for (const row of b.tools) upsertTool.run(row);
      // telemetry-pack tables fed by the logs walker (additive, every mode)
      this.addActivityDaily(b.activityDaily);
      this.addActivityHourly(b.activityHourly);
      this.addReliabilityDaily(b.reliability);
      this.addGovernanceDaily(b.governance);
      this.addPermissionModeDaily(b.permissionModes);
      this.addMcpDaily(b.mcp);
      this.addPluginDaily(b.plugins);
      this.upsertSessions(b.sessions);
      if (b.eventsIngested > 0) this.bumpCounter('otel_events_ingested', b.eventsIngested);
      if (b.eventsDropped > 0) this.bumpCounter('otel_events_dropped', b.eventsDropped);
      if (b.maxEventAt) this.raiseWatermark('otel_last_event_at', b.maxEventAt);
      return true;
    });
    return txn(batch);
  }

  // -------------------------------------------------------------------------
  // Ingest dedup — SHA-256 of the raw request body, retained for 15 minutes
  // -------------------------------------------------------------------------

  /**
   * Mark a request body as ingested. Returns false (and bumps otel_dedup_hits)
   * when the hash was already seen. Old rows are pruned opportunistically on
   * every call. MUST run inside the ingest transaction (both callers do).
   */
  tryMarkIngest(hash: string): boolean {
    this.pruneDedup(new Date(Date.now() - DEDUP_RETENTION_MS).toISOString());
    const res = this.db
      .prepare(`INSERT OR IGNORE INTO otel_ingest_dedup (hash, received_at) VALUES (?, ?)`)
      .run(hash, new Date().toISOString());
    if (res.changes === 0) {
      this.bumpCounter('otel_dedup_hits', 1);
      return false;
    }
    return true;
  }

  /** Delete dedup rows received before `beforeIso`; returns rows removed. */
  pruneDedup(beforeIso: string): number {
    return this.db.prepare(`DELETE FROM otel_ingest_dedup WHERE received_at < ?`).run(beforeIso).changes;
  }

  /** Delete session rows first seen before `beforeDate`; returns rows removed. */
  pruneSessions(beforeDate: string): number {
    return this.db.prepare(`DELETE FROM otel_sessions WHERE date < ?`).run(beforeDate).changes;
  }

  bumpCounter(key: string, delta: number): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + CAST(excluded.value AS INTEGER) AS TEXT)`,
      )
      .run(key, String(delta));
  }

  /** ISO strings compare lexicographically — keep the max. */
  private raiseWatermark(key: string, iso: string): void {
    this.db
      .prepare(
        `INSERT INTO sync_state (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = MAX(value, excluded.value)`,
      )
      .run(key, iso);
  }

  // -------------------------------------------------------------------------
  // Metrics pack-table upserts — plain additive statements, no transaction of
  // their own: the metrics ingest wraps them (with dedup) in ONE transaction.
  // -------------------------------------------------------------------------

  addActivityDaily(rows: ActivityDailyDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_activity_daily (date, user_id, active_user_s, active_cli_s, prompts, sessions)
       VALUES (@date, @userId, @activeUserS, @activeCliS, @prompts, @sessions)
       ON CONFLICT (date, user_id) DO UPDATE SET
         active_user_s = active_user_s + excluded.active_user_s,
         active_cli_s  = active_cli_s + excluded.active_cli_s,
         prompts       = prompts + excluded.prompts,
         sessions      = sessions + excluded.sessions`,
    );
    for (const row of rows) upsert.run(row);
  }

  addActivityHourly(rows: ActivityHourlyDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_activity_hourly (user_id, hour_utc, prompts, api_requests, sessions_started)
       VALUES (@userId, @hourUtc, @prompts, @apiRequests, @sessionsStarted)
       ON CONFLICT (user_id, hour_utc) DO UPDATE SET
         prompts          = prompts + excluded.prompts,
         api_requests     = api_requests + excluded.api_requests,
         sessions_started = sessions_started + excluded.sessions_started`,
    );
    for (const row of rows) upsert.run(row);
  }

  addMcpDaily(rows: McpDailyDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_mcp_daily (
         date, user_id, server_name, tool_calls, tool_failures, tokens, cost_cents, connections, connection_failures
       ) VALUES (@date, @userId, @serverName, @toolCalls, @toolFailures, @tokens, @costCents, @connections,
                 @connectionFailures)
       ON CONFLICT (date, user_id, server_name) DO UPDATE SET
         tool_calls          = tool_calls + excluded.tool_calls,
         tool_failures       = tool_failures + excluded.tool_failures,
         tokens              = tokens + excluded.tokens,
         cost_cents          = cost_cents + excluded.cost_cents,
         connections         = connections + excluded.connections,
         connection_failures = connection_failures + excluded.connection_failures`,
    );
    for (const row of rows) upsert.run(row);
  }

  addTokenMixDaily(rows: TokenMixDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_token_mix_daily (date, user_id, model, speed, effort, tokens, cost_cents)
       VALUES (@date, @userId, @model, @speed, @effort, @tokens, @costCents)
       ON CONFLICT (date, user_id, model, speed, effort) DO UPDATE SET
         tokens     = tokens + excluded.tokens,
         cost_cents = cost_cents + excluded.cost_cents`,
    );
    for (const row of rows) upsert.run(row);
  }

  addReliabilityDaily(rows: ReliabilityDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_reliability_daily (
         date, user_id, model, api_requests, api_errors, errors_429, errors_5xx, errors_other,
         refusals, compactions, internal_errors, total_duration_ms
       ) VALUES (@date, @userId, @model, @apiRequests, @apiErrors, @errors429, @errors5xx, @errorsOther,
                 @refusals, @compactions, @internalErrors, @totalDurationMs)
       ON CONFLICT (date, user_id, model) DO UPDATE SET
         api_requests      = api_requests + excluded.api_requests,
         api_errors        = api_errors + excluded.api_errors,
         errors_429        = errors_429 + excluded.errors_429,
         errors_5xx        = errors_5xx + excluded.errors_5xx,
         errors_other      = errors_other + excluded.errors_other,
         refusals          = refusals + excluded.refusals,
         compactions       = compactions + excluded.compactions,
         internal_errors   = internal_errors + excluded.internal_errors,
         total_duration_ms = total_duration_ms + excluded.total_duration_ms`,
    );
    for (const row of rows) upsert.run(row);
  }

  addGovernanceDaily(rows: GovernanceDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_governance_daily (
         date, user_id, src_config, src_hook, src_user_permanent, src_user_temporary,
         src_user_abort, src_user_reject, permission_mode_changes
       ) VALUES (@date, @userId, @srcConfig, @srcHook, @srcUserPermanent, @srcUserTemporary,
                 @srcUserAbort, @srcUserReject, @permissionModeChanges)
       ON CONFLICT (date, user_id) DO UPDATE SET
         src_config              = src_config + excluded.src_config,
         src_hook                = src_hook + excluded.src_hook,
         src_user_permanent      = src_user_permanent + excluded.src_user_permanent,
         src_user_temporary      = src_user_temporary + excluded.src_user_temporary,
         src_user_abort          = src_user_abort + excluded.src_user_abort,
         src_user_reject         = src_user_reject + excluded.src_user_reject,
         permission_mode_changes = permission_mode_changes + excluded.permission_mode_changes`,
    );
    for (const row of rows) upsert.run(row);
  }

  addPermissionModeDaily(rows: PermissionModeDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_permission_mode_daily (date, user_id, mode, changes)
       VALUES (@date, @userId, @mode, @changes)
       ON CONFLICT (date, user_id, mode) DO UPDATE SET
         changes = changes + excluded.changes`,
    );
    for (const row of rows) upsert.run(row);
  }

  addPluginDaily(rows: PluginDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_plugin_daily (date, user_id, plugin_name, installs, loads)
       VALUES (@date, @userId, @pluginName, @installs, @loads)
       ON CONFLICT (date, user_id, plugin_name) DO UPDATE SET
         installs = installs + excluded.installs,
         loads    = loads + excluded.loads`,
    );
    for (const row of rows) upsert.run(row);
  }

  /**
   * Merge observed sessions: first/last event times extend via MIN/MAX (ISO
   * strings compare lexicographically), `date` follows the earliest event so
   * it stays "date of first event" even across out-of-order batches.
   */
  upsertSessions(rows: SessionDelta[]): void {
    const upsert = this.db.prepare(
      `INSERT INTO otel_sessions (session_id, user_id, date, first_event_at, last_event_at, events, prompts)
       VALUES (@sessionId, @userId, @date, @firstEventAt, @lastEventAt, @events, @prompts)
       ON CONFLICT (session_id) DO UPDATE SET
         date           = CASE WHEN excluded.first_event_at < first_event_at THEN excluded.date ELSE date END,
         first_event_at = MIN(first_event_at, excluded.first_event_at),
         last_event_at  = MAX(last_event_at, excluded.last_event_at),
         events         = events + excluded.events,
         prompts        = prompts + excluded.prompts`,
    );
    for (const row of rows) upsert.run(row);
  }

  // -------------------------------------------------------------------------
  // Route aggregates
  // -------------------------------------------------------------------------

  /**
   * Per-user hourly activity-event counts for the time-of-day badges. Prompts
   * and API requests both count: prompts alone are too sparse to shape a
   * share (single digits in any given hour), and api_requests carries the same
   * time-of-day signal with far more of it. Tokens are deliberately NOT used —
   * one big-context run outweighs a whole morning of work, which is how a
   * "when do you work" badge ended up measuring "when do you burn context".
   *
   * Bounds are UTC hour keys ('YYYY-MM-DDTHH:00:00Z'), inclusive, like
   * usageRepo.hourlyTokens; the caller converts local days to that range.
   */
  hourlyActivity(fromHour: string, toHour: string): HourlyActivityRow[] {
    return this.db
      .prepare(
        `SELECT user_id, hour_utc, (prompts + api_requests) AS events
         FROM otel_activity_hourly
         WHERE hour_utc >= ? AND hour_utc <= ? AND (prompts + api_requests) > 0`,
      )
      .all(fromHour, toHour) as HourlyActivityRow[];
  }

  /** Per-user stats for the value-delivery badges — one GROUP BY query per table. */
  perUserBadgeStats(from: string, to: string): Map<number, UserBadgeStats> {
    const params = { from, to };
    const byUser = new Map<number, UserBadgeStats>();
    const acc = (userId: number): UserBadgeStats => {
      let s = byUser.get(userId);
      if (!s) {
        s = { ...EMPTY_BADGE_STATS };
        byUser.set(userId, s);
      }
      return s;
    };

    const skills = this.db
      .prepare(
        `SELECT user_id, COUNT(DISTINCT skill_name) AS distinct_skills,
                COALESCE(SUM(invocations), 0) AS skill_invocations
         FROM otel_skill_daily WHERE date BETWEEN @from AND @to GROUP BY user_id`,
      )
      .all(params) as Array<{ user_id: number; distinct_skills: number; skill_invocations: number }>;
    for (const r of skills) {
      const s = acc(r.user_id);
      s.distinctSkills = r.distinct_skills;
      s.skillInvocations = r.skill_invocations;
    }

    const mcp = this.db
      .prepare(
        `SELECT user_id, COALESCE(SUM(tool_calls), 0) AS mcp_calls,
                COALESCE(SUM(tool_failures), 0) AS mcp_failures
         FROM otel_mcp_daily WHERE date BETWEEN @from AND @to GROUP BY user_id`,
      )
      .all(params) as Array<{ user_id: number; mcp_calls: number; mcp_failures: number }>;
    for (const r of mcp) {
      const s = acc(r.user_id);
      s.mcpCalls = r.mcp_calls;
      s.mcpFailures = r.mcp_failures;
    }

    const servers = this.db
      .prepare(
        `SELECT user_id, COUNT(*) AS active_servers FROM (
           SELECT user_id, server_name, SUM(tool_calls) AS calls
           FROM otel_mcp_daily WHERE date BETWEEN @from AND @to
           GROUP BY user_id, server_name HAVING calls >= 10
         ) GROUP BY user_id`,
      )
      .all(params) as Array<{ user_id: number; active_servers: number }>;
    for (const r of servers) acc(r.user_id).activeMcpServers = r.active_servers;

    const agents = this.db
      .prepare(
        `SELECT user_id, COALESCE(SUM(invocations), 0) AS runs,
                COALESCE(SUM(success), 0) AS successes,
                COUNT(DISTINCT subagent_type) AS types
         FROM otel_agent_daily WHERE date BETWEEN @from AND @to GROUP BY user_id`,
      )
      .all(params) as Array<{ user_id: number; runs: number; successes: number; types: number }>;
    for (const r of agents) {
      const s = acc(r.user_id);
      s.subagentRuns = r.runs;
      s.subagentSuccesses = r.successes;
      s.distinctAgentTypes = r.types;
    }

    const plan = this.db
      .prepare(
        `SELECT user_id, COALESCE(SUM(changes), 0) AS entries
         FROM otel_permission_mode_daily
         WHERE mode = 'plan' AND date BETWEEN @from AND @to GROUP BY user_id`,
      )
      .all(params) as Array<{ user_id: number; entries: number }>;
    for (const r of plan) acc(r.user_id).planModeEntries = r.entries;

    const exitPlan = this.db
      .prepare(
        `SELECT user_id, COALESCE(SUM(accepted), 0) AS plans
         FROM otel_tool_daily
         WHERE tool_name = 'ExitPlanMode' AND date BETWEEN @from AND @to GROUP BY user_id`,
      )
      .all(params) as Array<{ user_id: number; plans: number }>;
    for (const r of exitPlan) acc(r.user_id).plansAccepted = r.plans;

    // All-time on purpose: no date filter. Compaction is a rare event, so the
    // Deep Diver badge counts it over the user's whole history — the same way
    // streaks are measured outside the selected range.
    const compactions = this.db
      .prepare(
        `SELECT user_id, COALESCE(SUM(compactions), 0) AS total
         FROM otel_reliability_daily WHERE compactions > 0 GROUP BY user_id`,
      )
      .all() as Array<{ user_id: number; total: number }>;
    for (const r of compactions) acc(r.user_id).compactions = r.total;

    return byUser;
  }

  skillTotals(from: string, to: string, scope: OtelScope = {}): SkillTotalsRow[] {
    const { fromSql, whereSql } = scopeSql('otel_skill_daily', scope);
    return this.db
      .prepare(
        `SELECT t.skill_name AS skill_name,
                COALESCE(SUM(t.invocations), 0) AS invocations,
                COUNT(DISTINCT CASE WHEN t.invocations > 0 THEN t.user_id END) AS users,
                COALESCE(SUM(t.cost_cents), 0) AS cost_cents,
                COALESCE(SUM(t.user_slash), 0) AS user_slash,
                COALESCE(SUM(t.proactive), 0) AS proactive,
                COALESCE(SUM(t.nested), 0) AS nested
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.skill_name
         ORDER BY invocations DESC, skill_name`,
      )
      .all(scopeParams(from, to, scope)) as SkillTotalsRow[];
  }

  agentTotals(from: string, to: string, scope: OtelScope = {}): AgentTotalsRow[] {
    const { fromSql, whereSql } = scopeSql('otel_agent_daily', scope);
    return this.db
      .prepare(
        `SELECT t.subagent_type AS subagent_type,
                COALESCE(SUM(t.invocations), 0) AS invocations,
                COUNT(DISTINCT CASE WHEN t.invocations > 0 THEN t.user_id END) AS users,
                COALESCE(SUM(t.success), 0) AS success,
                COALESCE(SUM(t.failure), 0) AS failure,
                COALESCE(SUM(t.cost_cents), 0) AS cost_cents
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.subagent_type
         ORDER BY invocations DESC, subagent_type`,
      )
      .all(scopeParams(from, to, scope)) as AgentTotalsRow[];
  }

  toolTotals(from: string, to: string, scope: OtelScope = {}, limit = 25): ToolTotalsRow[] {
    const { fromSql, whereSql } = scopeSql('otel_tool_daily', scope);
    return this.db
      .prepare(
        `SELECT t.tool_name AS tool_name,
                COALESCE(SUM(t.uses), 0) AS uses,
                COALESCE(SUM(t.success), 0) AS success,
                COALESCE(SUM(t.failure), 0) AS failure,
                COALESCE(SUM(t.accepted), 0) AS accepted,
                COALESCE(SUM(t.rejected), 0) AS rejected
         FROM ${fromSql}
         WHERE ${whereSql}
         GROUP BY t.tool_name
         ORDER BY uses DESC, tool_name
         LIMIT @limit`,
      )
      .all({ ...scopeParams(from, to, scope), limit }) as ToolTotalsRow[];
  }

  /** Every MCP tool in range (tool_name 'mcp__server__tool'), uncapped. */
  mcpToolTotals(from: string, to: string, scope: OtelScope = {}): McpToolTotalsRow[] {
    const { fromSql, whereSql } = scopeSql('otel_tool_daily', scope);
    return this.db
      .prepare(
        `SELECT t.tool_name AS tool_name,
                COALESCE(SUM(t.uses), 0) AS uses,
                COALESCE(SUM(t.success), 0) AS success,
                COALESCE(SUM(t.failure), 0) AS failure,
                COALESCE(SUM(t.accepted), 0) AS accepted,
                COALESCE(SUM(t.rejected), 0) AS rejected,
                COUNT(DISTINCT t.user_id) AS users
         FROM ${fromSql}
         WHERE ${whereSql} AND t.tool_name LIKE 'mcp\\_\\_%' ESCAPE '\\'
         GROUP BY t.tool_name
         ORDER BY uses DESC, tool_name`,
      )
      .all(scopeParams(from, to, scope)) as McpToolTotalsRow[];
  }

  /**
   * Per-user rollup: everyone with >=1 skill or agent invocation in range,
   * their top (most-invoked) skill resolved from the same aggregates.
   */
  userRollup(from: string, to: string, scope: OtelScope = {}): UserRollupRow[] {
    const skillScope = scopeSql('otel_skill_daily', scope);
    const perUserSkill = this.db
      .prepare(
        `SELECT t.user_id AS user_id, t.skill_name AS skill_name,
                COALESCE(SUM(t.invocations), 0) AS invocations
         FROM ${skillScope.fromSql}
         WHERE ${skillScope.whereSql}
         GROUP BY t.user_id, t.skill_name`,
      )
      .all(scopeParams(from, to, scope)) as Array<{ user_id: number; skill_name: string; invocations: number }>;

    const agentScope = scopeSql('otel_agent_daily', scope);
    const perUserAgent = this.db
      .prepare(
        `SELECT t.user_id AS user_id, COALESCE(SUM(t.invocations), 0) AS invocations
         FROM ${agentScope.fromSql}
         WHERE ${agentScope.whereSql}
         GROUP BY t.user_id`,
      )
      .all(scopeParams(from, to, scope)) as Array<{ user_id: number; invocations: number }>;

    interface Acc {
      skillInvocations: number;
      distinctSkills: number;
      agentInvocations: number;
      topSkill: string | null;
      topSkillInv: number;
    }
    const byUser = new Map<number, Acc>();
    const acc = (userId: number): Acc => {
      let a = byUser.get(userId);
      if (!a) {
        a = { skillInvocations: 0, distinctSkills: 0, agentInvocations: 0, topSkill: null, topSkillInv: 0 };
        byUser.set(userId, a);
      }
      return a;
    };
    for (const row of perUserSkill) {
      if (row.invocations <= 0) continue;
      const a = acc(row.user_id);
      a.skillInvocations += row.invocations;
      a.distinctSkills += 1;
      if (row.invocations > a.topSkillInv) {
        a.topSkillInv = row.invocations;
        a.topSkill = row.skill_name;
      }
    }
    for (const row of perUserAgent) {
      if (row.invocations <= 0) continue;
      acc(row.user_id).agentInvocations += row.invocations;
    }

    const ids = [...byUser.keys()];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const userRows = this.db
      .prepare(`SELECT id, name, email FROM users WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: number; name: string; email: string | null }>;
    const meta = new Map(userRows.map((u) => [u.id, u]));

    const out: UserRollupRow[] = [];
    for (const [userId, a] of byUser) {
      const m = meta.get(userId);
      out.push({
        user_id: userId,
        name: m?.name ?? `#${userId}`,
        email: m?.email ?? null,
        skill_invocations: a.skillInvocations,
        distinct_skills: a.distinctSkills,
        agent_invocations: a.agentInvocations,
        top_skill: a.topSkill,
      });
    }
    out.sort((x, y) => y.skill_invocations - x.skill_invocations || y.agent_invocations - x.agent_invocations || x.user_id - y.user_id);
    return out;
  }

  totals(from: string, to: string, scope: OtelScope = {}): OtelTotals {
    const skillScope = scopeSql('otel_skill_daily', scope);
    const skill = this.db
      .prepare(
        `SELECT COALESCE(SUM(t.invocations), 0) AS invocations,
                COUNT(DISTINCT CASE WHEN t.invocations > 0 THEN t.skill_name END) AS distinct_skills,
                COUNT(DISTINCT CASE WHEN t.invocations > 0 THEN t.user_id END) AS active_users,
                COALESCE(SUM(t.cost_cents), 0) AS cost_cents
         FROM ${skillScope.fromSql}
         WHERE ${skillScope.whereSql}`,
      )
      .get(scopeParams(from, to, scope)) as {
      invocations: number;
      distinct_skills: number;
      active_users: number;
      cost_cents: number;
    };

    const agentScope = scopeSql('otel_agent_daily', scope);
    const agent = this.db
      .prepare(
        `SELECT COALESCE(SUM(t.invocations), 0) AS invocations,
                COALESCE(SUM(t.cost_cents), 0) AS cost_cents
         FROM ${agentScope.fromSql}
         WHERE ${agentScope.whereSql}`,
      )
      .get(scopeParams(from, to, scope)) as { invocations: number; cost_cents: number };

    return {
      skillInvocations: skill.invocations,
      distinctSkills: skill.distinct_skills,
      agentInvocations: agent.invocations,
      activeSkillUsers: skill.active_users,
      skillCostCents: skill.cost_cents,
      agentCostCents: agent.cost_cents,
    };
  }

  hasData(from: string, to: string, scope: OtelScope = {}): boolean {
    for (const table of ['otel_skill_daily', 'otel_agent_daily', 'otel_tool_daily']) {
      const { fromSql, whereSql } = scopeSql(table, scope);
      const row = this.db
        .prepare(`SELECT 1 AS one FROM ${fromSql} WHERE ${whereSql} LIMIT 1`)
        .get(scopeParams(from, to, scope)) as { one: number } | undefined;
      if (row) return true;
    }
    return false;
  }
}
