/**
 * Week buckets must agree everywhere: the SQL bucket in usageRepo, the
 * gap-filled series in getOverview and `weekStartOf` (which the web app uses
 * for its labels and drill-down ranges). A disagreement would silently drop a
 * week's numbers on the floor, so check all three for both WEEK_START values.
 * Runs against an in-memory SQLite with the real migrations.
 */
import Database from 'better-sqlite3';
import { DEFAULT_WORKWEEK, addDays, weekStartOf, weekdayOf, type WeekStart } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import { createRepos } from '../src/repos';
import { UsageRepo } from '../src/repos/usageRepo';
import { getOverview } from '../src/services/overview';
import { configureCalendar } from '../src/util/time';

// Thursday → Wednesday three weeks later: both ends cut a week in half
const FROM = '2026-10-22';
const TO = '2026-11-11';

function seed() {
  const db = new Database(':memory:');
  migrate(db);
  db.prepare(`INSERT INTO users (id, actor_type, email, name, in_roster, first_seen_date) VALUES (1, 'user', 'a@x.dev', 'Ava', 1, '2026-10-01')`).run();
  const daily = db.prepare(`INSERT INTO usage_daily (date, user_id, num_sessions, raw_json) VALUES (?, 1, ?, '{}')`);
  const model = db.prepare(`INSERT INTO usage_daily_models (usage_daily_id, model, cost_cents) VALUES (?, 'claude-x', ?)`);
  // one row a day, a day before and after the range too; distinct values so a
  // row filed under the wrong week changes the sums
  const sessionsByDate = new Map<string, number>();
  for (let i = 0, d = addDays(FROM, -1); d <= addDays(TO, 1); i++, d = addDays(d, 1)) {
    const id = daily.run(d, i + 1).lastInsertRowid;
    model.run(id, (i + 1) * 10);
    if (d >= FROM && d <= TO) sessionsByDate.set(d, i + 1);
  }
  return { db, sessionsByDate };
}

/** Reference buckets: in-range sessions grouped by weekStartOf. */
function expectedWeeks(sessionsByDate: Map<string, number>, ws: WeekStart): Map<string, number> {
  const out = new Map<string, number>();
  for (const [d, s] of sessionsByDate) {
    const k = weekStartOf(d, ws);
    out.set(k, (out.get(k) ?? 0) + s);
  }
  return out;
}

let db: Database.Database | null = null;
afterEach(() => {
  configureCalendar({ workweek: [...DEFAULT_WORKWEEK], weekStart: 0 });
  db?.close();
  db = null;
});

describe.each([0, 1] as const)('week buckets with weekStart=%i', (ws) => {
  it('SQL buckets start on the configured weekday and match weekStartOf', () => {
    configureCalendar({ workweek: [...DEFAULT_WORKWEEK], weekStart: ws });
    const seeded = seed();
    db = seeded.db;
    const usage = new UsageRepo(db);
    const expected = expectedWeeks(seeded.sessionsByDate, ws);

    const core = usage.dailyCore(FROM, TO, undefined, 'week');
    expect(core.map((r) => r.date).sort()).toEqual([...expected.keys()].sort());
    for (const r of core) {
      expect(weekdayOf(r.date)).toBe(ws);
      expect(r.sessions).toBe(expected.get(r.date));
    }

    const cost = usage.dailyCost(FROM, TO, undefined, 'week');
    expect(cost.map((r) => r.date).sort()).toEqual([...expected.keys()].sort());
    for (const r of cost) expect(r.cost_cents).toBe((expected.get(r.date) ?? 0) * 10);
  });

  it('the overview series gap-fills the same buckets, so nothing is dropped', () => {
    configureCalendar({ workweek: [...DEFAULT_WORKWEEK], weekStart: ws });
    const seeded = seed();
    db = seeded.db;
    const expected = expectedWeeks(seeded.sessionsByDate, ws);

    const { daily } = getOverview(createRepos(db, { rosterScoped: true }), { from: FROM, to: TO, gran: 'week' });
    expect(daily.map((p) => p.date)).toEqual([...expected.keys()].sort());
    for (const p of daily) expect(p.sessions).toBe(expected.get(p.date));
    const total = [...seeded.sessionsByDate.values()].reduce((a, b) => a + b, 0);
    expect(daily.reduce((a, p) => a + p.sessions, 0)).toBe(total);
  });
});

it('defaults to Sunday weeks when the calendar is never configured', () => {
  const seeded = seed();
  db = seeded.db;
  const core = new UsageRepo(db).dailyCore(FROM, TO, undefined, 'week');
  for (const r of core) expect(weekdayOf(r.date)).toBe(0);
});
