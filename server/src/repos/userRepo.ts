import type { ActorType, UserDto } from '@dash/shared';
import type { Db } from '../db/connection';

export interface UserRow {
  id: number;
  actor_type: ActorType;
  email: string | null;
  api_key_name: string | null;
  anthropic_user_id: string | null;
  name: string;
  role: string | null;
  added_at: string | null;
  in_roster: number;
  team_id: number | null;
  first_seen_date: string | null;
  last_seen_date: string | null;
  customer_type: string | null;
  subscription_type: string | null;
  country: string | null;
  team_name?: string | null;
}

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    actorType: row.actor_type,
    email: row.email,
    apiKeyName: row.api_key_name,
    name: row.name,
    role: row.role,
    addedAt: row.added_at,
    inRoster: row.in_roster === 1,
    teamId: row.team_id,
    teamName: row.team_name ?? null,
    firstSeenDate: row.first_seen_date,
    lastSeenDate: row.last_seen_date,
    customerType: row.customer_type,
    subscriptionType: row.subscription_type,
    country: row.country,
  };
}

const SELECT_WITH_TEAM = `
  SELECT u.*, t.name AS team_name
  FROM users u
  LEFT JOIN teams t ON t.id = u.team_id
`;

export class UserRepo {
  constructor(private readonly db: Db) {}

  listAll(): UserRow[] {
    return this.db.prepare(`${SELECT_WITH_TEAM} ORDER BY u.name COLLATE NOCASE, u.id`).all() as UserRow[];
  }

  getById(id: number): UserRow | undefined {
    return this.db.prepare(`${SELECT_WITH_TEAM} WHERE u.id = ?`).get(id) as UserRow | undefined;
  }

  getByEmail(email: string): UserRow | undefined {
    return this.db
      .prepare(`${SELECT_WITH_TEAM} WHERE u.actor_type = 'user' AND u.email = ?`)
      .get(email.toLowerCase()) as UserRow | undefined;
  }

  getByApiKeyName(apiKeyName: string): UserRow | undefined {
    return this.db
      .prepare(`${SELECT_WITH_TEAM} WHERE u.actor_type = 'api_key' AND u.api_key_name = ?`)
      .get(apiKeyName) as UserRow | undefined;
  }

  getByAnthropicUserId(anthropicUserId: string): UserRow | undefined {
    return this.db.prepare(`${SELECT_WITH_TEAM} WHERE u.anthropic_user_id = ?`).get(anthropicUserId) as
      | UserRow
      | undefined;
  }

  insertUserActor(email: string, name: string): number {
    const res = this.db
      .prepare(
        `INSERT INTO users (actor_type, email, name, in_roster) VALUES ('user', ?, ?, 0)`,
      )
      .run(email.toLowerCase(), name);
    return Number(res.lastInsertRowid);
  }

  insertApiActor(apiKeyName: string): number {
    const res = this.db
      .prepare(
        `INSERT INTO users (actor_type, api_key_name, name, in_roster) VALUES ('api_key', ?, ?, 0)`,
      )
      .run(apiKeyName, apiKeyName);
    return Number(res.lastInsertRowid);
  }

  insertStubForAccountId(anthropicUserId: string): number {
    const name = `(unknown) ${anthropicUserId.slice(0, 8)}`;
    const res = this.db
      .prepare(
        `INSERT INTO users (actor_type, email, name, anthropic_user_id, in_roster)
         VALUES ('user', NULL, ?, ?, 0)`,
      )
      .run(name, anthropicUserId);
    return Number(res.lastInsertRowid);
  }

  /**
   * Program tier observed on `asOfDate` (from the claude_code usage report).
   * Date-guarded so a backfill re-syncing old days never overwrites a newer
   * observation with a stale one.
   */
  updateProgramTier(id: number, asOfDate: string, customerType: string, subscriptionType: string | null): void {
    this.db
      .prepare(
        `UPDATE users SET
           customer_type = ?,
           subscription_type = ?,
           tier_as_of = ?,
           updated_at = datetime('now')
         WHERE id = ? AND (tier_as_of IS NULL OR tier_as_of <= ?)`,
      )
      .run(customerType, subscriptionType, asOfDate, id, asOfDate);
  }

  /**
   * Latest observed Claude Code app version (telemetry resource attr).
   * Guarded by cc_app_version_as_of so a replayed/late batch never overwrites
   * a newer observation with an older one.
   */
  updateAppVersion(id: number, version: string, asOfIso: string): void {
    this.db
      .prepare(
        `UPDATE users SET
           cc_app_version = ?,
           cc_app_version_as_of = ?,
           updated_at = datetime('now')
         WHERE id = ? AND (cc_app_version_as_of IS NULL OR cc_app_version_as_of <= ?)`,
      )
      .run(version, asOfIso, id, asOfIso);
  }

  /** Roster sync: refresh identity fields and mark rostered. */
  applyRosterInfo(
    id: number,
    info: { anthropicUserId: string; email: string; name: string; role: string; addedAt: string },
  ): void {
    this.db
      .prepare(
        `UPDATE users SET
           anthropic_user_id = ?,
           email = ?,
           name = ?,
           role = ?,
           added_at = ?,
           in_roster = 1,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(info.anthropicUserId, info.email.toLowerCase(), info.name, info.role, info.addedAt, id);
  }

  insertRosterUser(info: {
    anthropicUserId: string;
    email: string;
    name: string;
    role: string;
    addedAt: string;
  }): number {
    const res = this.db
      .prepare(
        `INSERT INTO users (actor_type, email, name, anthropic_user_id, role, added_at, in_roster)
         VALUES ('user', ?, ?, ?, ?, ?, 1)`,
      )
      .run(info.email.toLowerCase(), info.name, info.anthropicUserId, info.role, info.addedAt);
    return Number(res.lastInsertRowid);
  }

  /**
   * Enterprise identity refresh — gentler than applyRosterInfo (the Analytics
   * API exposes no role/added_at, and there is no authoritative seat list).
   * Sets in_roster=1 only when asked and NEVER resets it to 0; the name is
   * only overwritten when a non-empty one is provided (usage actors carry
   * names, engagement records don't).
   */
  applyEnterpriseIdentity(
    id: number,
    info: { anthropicUserId: string | null; email: string; name: string; markRostered: boolean },
  ): void {
    this.db
      .prepare(
        `UPDATE users SET
           anthropic_user_id = COALESCE(?, anthropic_user_id),
           email = ?,
           name = CASE WHEN ? != '' THEN ? ELSE name END,
           in_roster = CASE WHEN ? THEN 1 ELSE in_roster END,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(info.anthropicUserId, info.email.toLowerCase(), info.name, info.name, info.markRostered ? 1 : 0, id);
  }

  /**
   * Merge a duplicate actor row (typically an hourly-sync stub holding only
   * anthropic_user_id) into the surviving row (typically the daily-sync row
   * holding the email): repoint usage FKs, drop disposable snapshot rows,
   * widen seen dates, then delete the duplicate — all in one transaction.
   */
  mergeInto(survivorId: number, stubId: number): void {
    const txn = this.db.transaction(() => {
      const stub = this.db
        .prepare(`SELECT first_seen_date, last_seen_date FROM users WHERE id = ?`)
        .get(stubId) as { first_seen_date: string | null; last_seen_date: string | null } | undefined;
      if (!stub) return;

      // usage_hourly: re-key to the survivor, summing token columns when both
      // rows already have data for the same hour (UNIQUE(user_id, hour_utc)).
      this.db
        .prepare(
          `INSERT INTO usage_hourly (
             user_id, hour_utc, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
             web_search_requests
           )
           SELECT @survivor, hour_utc, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens,
                  web_search_requests
           FROM usage_hourly WHERE user_id = @stub
           ON CONFLICT (user_id, hour_utc) DO UPDATE SET
             uncached_input_tokens = uncached_input_tokens + excluded.uncached_input_tokens,
             cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
             cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
             output_tokens         = output_tokens + excluded.output_tokens,
             web_search_requests   = web_search_requests + excluded.web_search_requests`,
        )
        .run({ survivor: survivorId, stub: stubId });
      this.db.prepare(`DELETE FROM usage_hourly WHERE user_id = ?`).run(stubId);

      // usage_daily: stubs should never hold daily rows — defensive repointing.
      // On UNIQUE(date, user_id, terminal_type, customer_type) collision keep
      // the survivor's row and drop the stub's (models cascade with it).
      this.db
        .prepare(
          `DELETE FROM usage_daily
           WHERE user_id = @stub AND EXISTS (
             SELECT 1 FROM usage_daily s
             WHERE s.user_id = @survivor AND s.date = usage_daily.date
               AND s.terminal_type = usage_daily.terminal_type
               AND s.customer_type = usage_daily.customer_type
           )`,
        )
        .run({ survivor: survivorId, stub: stubId });
      this.db.prepare(`UPDATE usage_daily SET user_id = ? WHERE user_id = ?`).run(survivorId, stubId);

      // otel_* daily aggregates: re-key to the survivor, summing counters when
      // both rows already cover the same (date, entity) — like usage_hourly.
      const otelTables: Array<{ table: string; key: string; counters: string[] }> = [
        {
          table: 'otel_skill_daily',
          key: 'skill_name',
          counters: ['invocations', 'user_slash', 'proactive', 'nested', 'cost_cents'],
        },
        {
          table: 'otel_agent_daily',
          key: 'subagent_type',
          counters: ['invocations', 'success', 'failure', 'cost_cents'],
        },
        {
          table: 'otel_tool_daily',
          key: 'tool_name',
          counters: ['uses', 'success', 'failure', 'accepted', 'rejected'],
        },
      ];
      for (const { table, key, counters } of otelTables) {
        const cols = counters.join(', ');
        const sums = counters.map((c) => `${c} = ${c} + excluded.${c}`).join(', ');
        this.db
          .prepare(
            `INSERT INTO ${table} (date, user_id, ${key}, ${cols})
             SELECT date, @survivor, ${key}, ${cols} FROM ${table} WHERE user_id = @stub
             ON CONFLICT (date, user_id, ${key}) DO UPDATE SET ${sums}`,
          )
          .run({ survivor: survivorId, stub: stubId });
        this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(stubId);
      }

      // stub snapshots are disposable; PK (snapshot_date, user_id, range_key) could collide
      this.db.prepare(`DELETE FROM score_snapshots WHERE user_id = ?`).run(stubId);

      if (stub.first_seen_date) this.touchSeenDates(survivorId, stub.first_seen_date);
      if (stub.last_seen_date) this.touchSeenDates(survivorId, stub.last_seen_date);

      // frees the stub's anthropic_user_id so the survivor can take it
      this.db.prepare(`DELETE FROM users WHERE id = ?`).run(stubId);
    });
    txn();
  }

  /** Previously-rostered users absent from the latest roster fetch → in_roster=0. Never delete. */
  markDeparted(currentRosterIds: number[]): number {
    if (currentRosterIds.length === 0) {
      return this.db
        .prepare(`UPDATE users SET in_roster = 0, updated_at = datetime('now') WHERE actor_type='user' AND in_roster = 1`)
        .run().changes;
    }
    const placeholders = currentRosterIds.map(() => '?').join(',');
    return this.db
      .prepare(
        `UPDATE users SET in_roster = 0, updated_at = datetime('now')
         WHERE actor_type = 'user' AND in_roster = 1 AND id NOT IN (${placeholders})`,
      )
      .run(...currentRosterIds).changes;
  }

  /** Widen first_seen/last_seen to include `date`. */
  touchSeenDates(userId: number, date: string): void {
    this.db
      .prepare(
        `UPDATE users SET
           first_seen_date = CASE WHEN first_seen_date IS NULL OR first_seen_date > ? THEN ? ELSE first_seen_date END,
           last_seen_date  = CASE WHEN last_seen_date  IS NULL OR last_seen_date  < ? THEN ? ELSE last_seen_date  END,
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(date, date, date, date, userId);
  }

  setTeam(userId: number, teamId: number | null): void {
    this.db
      .prepare(`UPDATE users SET team_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(teamId, userId);
  }

  /** Admin-set location (validated ISO code or null to clear). */
  setCountry(userId: number, country: string | null): void {
    this.db
      .prepare(`UPDATE users SET country = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(country, userId);
  }

  rosteredUserCount(teamId?: number): number {
    const row = (
      teamId === undefined
        ? this.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE actor_type='user' AND in_roster=1`).get()
        : this.db
            .prepare(`SELECT COUNT(*) AS n FROM users WHERE actor_type='user' AND in_roster=1 AND team_id = ?`)
            .get(teamId)
    ) as { n: number };
    return row.n;
  }

  unassignedRosteredCount(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE actor_type='user' AND in_roster=1 AND team_id IS NULL`)
      .get() as { n: number };
    return row.n;
  }
}
