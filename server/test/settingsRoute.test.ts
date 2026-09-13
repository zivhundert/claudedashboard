/**
 * The AI coach kill switch: anyone may turn it OFF, turning it back ON needs
 * the admin password (x-admin-password). Settings storage is an in-memory stub.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_SETTINGS, type AppSettings } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
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
  const ctx = { env: { adminPassword: opts.adminPassword, orgTimezone: 'UTC' }, repos: { settings } } as unknown as AppContext;
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
