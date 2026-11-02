/**
 * Scoring reads the configured WORKWEEK: the same Mon–Fri range counts 5
 * workdays once the calendar says Mon–Fri, and 4 under the Sun–Thu default.
 * Runs buildLeaderboardData against an in-memory SQLite with the real migrations.
 */
import Database from 'better-sqlite3';
import { DEFAULT_WORKWEEK } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import { createRepos } from '../src/repos';
import { buildLeaderboardData } from '../src/services/scoring';
import { configureCalendar } from '../src/util/time';

// Mon 26 – Fri 30 Oct 2026; the person works Mon–Thu
const FROM = '2026-10-26';
const TO = '2026-10-30';

function seed() {
  const db = new Database(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO users (id, actor_type, email, name, in_roster, first_seen_date) VALUES (1, 'user', 'a@x.dev', 'Ava', 1, '2026-10-01')`).run();
  const daily = db.prepare(`INSERT INTO usage_daily (date, user_id, num_sessions, raw_json) VALUES (?, 1, 8, '{}')`);
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']) daily.run(d);
  return db;
}

let db: Database.Database | null = null;
afterEach(() => {
  configureCalendar({ workweek: [...DEFAULT_WORKWEEK], weekStart: 0 });
  db?.close();
  db = null;
});

describe('buildLeaderboardData follows WORKWEEK', () => {
  it('counts 5 workdays in a Mon–Fri range when the week is Mon–Fri', () => {
    configureCalendar({ workweek: [1, 2, 3, 4, 5], weekStart: 1 });
    db = seed();
    const data = buildLeaderboardData(createRepos(db, { rosterScoped: true }), { from: FROM, to: TO });
    expect(data.workdays).toBe(5);
    expect(data.entryByUserId.get(1)?.metrics).toMatchObject({ activeDays: 4, workdays: 5 });
  });

  it('counts 4 under the Sun–Thu default', () => {
    db = seed();
    const data = buildLeaderboardData(createRepos(db, { rosterScoped: true }), { from: FROM, to: TO });
    expect(data.entryByUserId.get(1)?.metrics).toMatchObject({ activeDays: 4, workdays: 4 });
  });
});
