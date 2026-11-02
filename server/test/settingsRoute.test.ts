/**
 * The AI coach kill switch: anyone may turn it OFF, turning it back ON needs
 * the admin password (x-admin-password). Plus the env-owned fields (zone and
 * calendar): served from env, never stored. Settings storage is an in-memory
 * stub, except for the ensureDefaults check, which uses the real repo.
 */
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_SETTINGS, type AppSettings } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import { migrate } from '../src/db/migrate';
import { SettingsRepo } from '../src/repos/settingsRepo';
import { registerSettingsRoutes } from '../src/routes/settings';

function buildApp(opts: { adminPassword: string | null; stored?: Partial<AppSettings> }): { app: FastifyInstance; state: () => AppSettings } {
  let current: AppSettings = { ...DEFAULT_SETTINGS, ...opts.stored };
  const settings = {
    getMerged: () => current,
    setMany: (patch: Partial<AppSettings>) => {
      current = { ...current, ...patch };
      return current;
    },
  };
  const ctx = {
    env: { adminPassword: opts.adminPassword, orgTimezone: 'UTC', workweek: [1, 2, 3, 4, 5], weekStart: 1 },
    repos: { settings },
  } as unknown as AppContext;
  const app = Fastify();
  registerSettingsRoutes(app, ctx);
  return { app, state: () => current };
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

const put = (a: FastifyInstance, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  a.inject({ method: 'PUT', url: '/api/settings', payload: body, headers: { 'content-type': 'application/json', ...headers } });

describe('PUT /api/settings — aiCoachEnabled gate', () => {
  it('turning the coach OFF needs no password', async () => {
    const t = buildApp({ adminPassword: 'secret-1' });
    app = t.app;
    const res = await put(app, { aiCoachEnabled: false });
    expect(res.statusCode).toBe(200);
    expect(t.state().aiCoachEnabled).toBe(false);
  });

  it('turning it back ON without the password → 401; with a wrong one → 401; with the right one → 200', async () => {
    const t = buildApp({ adminPassword: 'secret-1', stored: { aiCoachEnabled: false } });
    app = t.app;
    expect((await put(app, { aiCoachEnabled: true })).statusCode).toBe(401);
    expect((await put(app, { aiCoachEnabled: true }, { 'x-admin-password': 'nope' })).statusCode).toBe(401);
    expect(t.state().aiCoachEnabled).toBe(false);
    const ok = await put(app, { aiCoachEnabled: true }, { 'x-admin-password': 'secret-1' });
    expect(ok.statusCode).toBe(200);
    expect(t.state().aiCoachEnabled).toBe(true);
  });

  it('turning it ON when no ADMIN_PASSWORD is configured → 403', async () => {
    const t = buildApp({ adminPassword: null, stored: { aiCoachEnabled: false } });
    app = t.app;
    const res = await put(app, { aiCoachEnabled: true }, { 'x-admin-password': 'anything' });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('admin_password_not_configured');
  });

  it('saving with aiCoachEnabled already true needs no password (no transition)', async () => {
    const t = buildApp({ adminPassword: 'secret-1' });
    app = t.app;
    const res = await put(app, { aiCoachEnabled: true, aiCoachPriceInputUsdPerMTok: 1.25 });
    expect(res.statusCode).toBe(200);
    expect(t.state().aiCoachPriceInputUsdPerMTok).toBe(1.25);
  });
});

describe('/api/settings — env-owned calendar', () => {
  const CALENDAR = { workweek: [1, 2, 3, 4, 5], weekStart: 1 };

  it('GET serves the calendar from env, next to the stored settings', async () => {
    const t = buildApp({ adminPassword: null });
    app = t.app;
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ displayTimezone: 'UTC', calendar: CALENDAR });
  });

  it('PUT can neither change nor store it', async () => {
    const t = buildApp({ adminPassword: null });
    app = t.app;
    const res = await put(app, { calendar: { workweek: [6], weekStart: 0 }, workweek: [6], inactiveDays: 9 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ calendar: CALENDAR, inactiveDays: 9 });
    expect(t.state()).not.toHaveProperty('calendar');
    expect(t.state()).not.toHaveProperty('workweek');
  });

  it('ensureDefaults never writes calendar rows to the settings table', () => {
    const db = new Database(':memory:');
    migrate(db);
    new SettingsRepo(db).ensureDefaults();
    const keys = (db.prepare(`SELECT key FROM settings`).all() as Array<{ key: string }>).map((r) => r.key);
    db.close();
    expect(keys).toContain('displayTimezone');
    expect(keys).not.toContain('workweek');
    expect(keys).not.toContain('weekStart');
    expect(keys).not.toContain('calendar');
  });

  it('ignores calendar rows an earlier build left in the settings table', () => {
    const db = new Database(':memory:');
    migrate(db);
    const insert = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    insert.run('workweek', '[0,1,2,3,4]');
    insert.run('weekStart', '0');
    const repo = new SettingsRepo(db);
    repo.ensureDefaults();
    expect(repo.getMerged()).not.toHaveProperty('workweek');
    expect(repo.getMerged()).not.toHaveProperty('weekStart');
    // even a patch that smuggles them in neither returns nor rewrites them
    const saved = repo.setMany({ inactiveDays: 9, workweek: [6] } as Partial<AppSettings>);
    expect(saved.inactiveDays).toBe(9);
    expect(saved).not.toHaveProperty('workweek');
    expect(saved).not.toHaveProperty('weekStart');
    const stale = db.prepare(`SELECT value FROM settings WHERE key = 'workweek'`).get() as { value: string };
    db.close();
    expect(stale.value).toBe('[0,1,2,3,4]');
  });
});
