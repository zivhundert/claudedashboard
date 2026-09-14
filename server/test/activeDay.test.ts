/**
 * One definition of "active": the Overview KPI, the trend bars, scoring's
 * active days, streak days and the "see who" drawer (plus its "not active"
 * complement) must all agree, and a day with edits but no session start
 * counts as active. Runs against an in-memory SQLite with the real migrations.
 */
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate';
import { BreakdownRepo } from '../src/repos/breakdownRepo';
import { UsageRepo } from '../src/repos/usageRepo';

const FROM = '2026-09-01';
const TO = '2026-09-07';

function seed() {
  const db = new Database(':memory:');
  migrate(db);
  const user = db.prepare(`INSERT INTO users (id, actor_type, email, name, in_roster, first_seen_date) VALUES (?, 'user', ?, ?, 1, '2026-08-01')`);
  user.run(1, 'a@x.dev', 'Ava Sessions'); // sessions
  user.run(2, 'b@x.dev', 'Ben Midnight'); // edits + lines, zero sessions (session started the day before)
  user.run(3, 'c@x.dev', 'Cal Zero'); // a row with every counter at 0
  user.run(4, 'd@x.dev', 'Dee Idle'); // no rows at all
  db.prepare(`INSERT INTO users (id, actor_type, api_key_name, name) VALUES (5, 'api_key', 'ci-key', 'CI key')`).run();

  const row = db.prepare(
    `INSERT INTO usage_daily (date, user_id, num_sessions, lines_added, commits, edit_accepted, raw_json)
     VALUES (@date, @user, @sessions, @lines, @commits, @accepted, '{}')`,
  );
  row.run({ date: '2026-09-02', user: 1, sessions: 3, lines: 120, commits: 1, accepted: 4 });
  row.run({ date: '2026-09-03', user: 2, sessions: 0, lines: 80, commits: 0, accepted: 2 });
  row.run({ date: '2026-09-04', user: 2, sessions: 0, lines: 0, commits: 0, accepted: 1 });
  row.run({ date: '2026-09-05', user: 3, sessions: 0, lines: 0, commits: 0, accepted: 0 });
  row.run({ date: '2026-09-06', user: 5, sessions: 9, lines: 900, commits: 9, accepted: 9 }); // api key: never a person
  return db;
}

let db: Database.Database | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

describe('active-day definition is shared by every consumer', () => {
  it('KPI, per-bucket bars, drawer and its complement agree; edits-without-session count as active', () => {
    db = seed();
    const usage = new UsageRepo(db);
    const breakdown = new BreakdownRepo(db, true);

    const kpi = usage.peopleKpis(FROM, TO);
    expect(kpi.active_users).toBe(2); // Ava + Ben; Cal's all-zero row and Dee do not count
    expect(kpi.active_rostered).toBe(2);

    const bars = usage.dailyCore(FROM, TO, undefined, 'day');
    const activeInBars = new Set(bars.filter((b) => b.active_users > 0).map((b) => b.date));
    expect(activeInBars).toEqual(new Set(['2026-09-02', '2026-09-03', '2026-09-04']));

    const drawer = breakdown.query('active-users', '', FROM, TO);
    expect(drawer.rows.map((r) => r.name).sort()).toEqual(['Ava Sessions', 'Ben Midnight']);
    expect(drawer.rows.length).toBe(kpi.active_users);

    const inactive = breakdown.inactiveUsers(FROM, TO);
    expect(inactive.map((r) => r.name).sort()).toEqual(['Cal Zero', 'Dee Idle']);
    expect(drawer.rows.length + inactive.length).toBe(4); // every rostered person is on exactly one side

    const days = usage.userActiveDays(FROM, TO);
    expect(days.filter((d) => d.user_id === 2).map((d) => d.date).sort()).toEqual(['2026-09-03', '2026-09-04']);
    expect(days.some((d) => d.user_id === 3)).toBe(false);

    const perUser = usage.perUserDaily(FROM, TO);
    expect(perUser.find((r) => r.user_id === 2)?.active_days).toBe(2);
    expect(perUser.find((r) => r.user_id === 3)?.active_days ?? 0).toBe(0);
  });
});
