/**
 * Route-level contract for the coach endpoints: which local/upstream failure
 * becomes which HTTP status + error code. The service is stubbed; no model,
 * no database.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { AiUpstreamError } from '../src/ai/foundryClient';
import type { AppContext } from '../src/context';
import { registerRecommendationRoutes } from '../src/routes/recommendations';
import { NoMetricsError, RateLimitedError } from '../src/services/recommendations';

const USER = { id: 7, actor_type: 'user', email: 'dev@example.com', name: 'Dev' };
const RANGE = { from: '2026-09-01', to: '2026-09-13' };
const URL = `/api/users/7/recommendations?from=${RANGE.from}&to=${RANGE.to}`;

function buildApp(opts: { userExists?: boolean; coachEnabled?: boolean; getOrGenerate: () => Promise<unknown> }): FastifyInstance {
  const users = {
    getById: (id: number) => (opts.userExists !== false && id === USER.id ? USER : undefined),
    getByEmail: (email: string) => (opts.userExists !== false && email === USER.email ? USER : undefined),
  };
  const ctx = {
    env: { adminPassword: null },
    repos: { users, settings: { getMerged: () => ({ aiCoachEnabled: opts.coachEnabled ?? true }) } },
    ai: { getOrGenerate: opts.getOrGenerate },
  } as unknown as AppContext;
  const app = Fastify();
  registerRecommendationRoutes(app, ctx);
  return app;
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('GET /api/users/:idOrEmail/recommendations — error mapping', () => {
  it('model_not_deployed → 503 with the classified code and message (NOT user_not_found)', async () => {
    const msg = 'deployment "gpt-5.6-luna" does not exist at 172.17.0.1:3000 — create it or change FOUNDRY_MODEL';
    app = buildApp({ getOrGenerate: () => Promise.reject(new AiUpstreamError('model_not_deployed', msg, 404)) });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'model_not_deployed', message: msg });
  });

  it.each(['auth_failed', 'unreachable'] as const)('%s → 503', async (code) => {
    app = buildApp({ getOrGenerate: () => Promise.reject(new AiUpstreamError(code, `${code} happened`)) });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: code, message: `${code} happened` });
  });

  it.each(['upstream_rate_limited', 'bad_request', 'upstream_error', 'bad_answer'] as const)('%s → 502', async (code) => {
    app = buildApp({ getOrGenerate: () => Promise.reject(new AiUpstreamError(code, `${code} happened`, 500)) });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: code, message: `${code} happened` });
  });

  it('NoMetricsError → 404 no_metrics_for_range naming the range', async () => {
    app = buildApp({ getOrGenerate: () => Promise.reject(new NoMetricsError(USER.id, RANGE)) });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('no_metrics_for_range');
    expect(body.message).toContain(RANGE.from);
    expect(body.message).toContain(RANGE.to);
  });

  it('user_not_found ONLY when findUser resolves nobody — the service is never called', async () => {
    let called = 0;
    app = buildApp({
      userExists: false,
      getOrGenerate: () => {
        called += 1;
        return Promise.reject(new Error('should not run'));
      },
    });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('user_not_found');
    expect(called).toBe(0);

    // and by email, same answer
    const byEmail = await app.inject({ method: 'GET', url: `/api/users/nobody%40example.com/recommendations` });
    expect((byEmail.json() as { error: string }).error).toBe('user_not_found');
  });

  it('a resolved user never yields user_not_found, whatever the service throws', async () => {
    for (const err of [
      new AiUpstreamError('model_not_deployed', 'x', 404),
      new AiUpstreamError('upstream_error', 'x', 404),
      new NoMetricsError(USER.id, RANGE),
    ]) {
      app = buildApp({ getOrGenerate: () => Promise.reject(err) });
      const res = await app.inject({ method: 'GET', url: URL });
      expect((res.json() as { error: string }).error).not.toBe('user_not_found');
      await app.close();
      app = null;
    }
  });

  it('RateLimitedError → 429 with Retry-After', async () => {
    app = buildApp({ getOrGenerate: () => Promise.reject(new RateLimitedError(420)) });
    const res = await app.inject({ method: 'POST', url: `/api/users/7/recommendations/regenerate?from=${RANGE.from}&to=${RANGE.to}` });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('420');
    expect((res.json() as { error: string; retryAfterSec: number }).error).toBe('rate_limited');
  });

  it('success passes the service payload through', async () => {
    app = buildApp({ getOrGenerate: () => Promise.resolve({ summary: 'ok', cached: true }) });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ summary: 'ok', cached: true });
  });

  it('ranges shorter than 7 days → 400 range_too_short, no model call', async () => {
    let called = 0;
    app = buildApp({
      getOrGenerate: () => {
        called += 1;
        return Promise.resolve({});
      },
    });
    const short = await app.inject({ method: 'GET', url: '/api/users/7/recommendations?from=2026-09-08&to=2026-09-13' }); // 6 days
    expect(short.statusCode).toBe(400);
    expect((short.json() as { error: string }).error).toBe('range_too_short');
    const ok = await app.inject({ method: 'GET', url: '/api/users/7/recommendations?from=2026-09-07&to=2026-09-13' }); // 7 days
    expect(ok.statusCode).toBe(200);
    expect(called).toBe(1);
  });

  it('ai_disabled when the Settings switch is off, even with a key configured', async () => {
    let called = 0;
    app = buildApp({
      coachEnabled: false,
      getOrGenerate: () => {
        called += 1;
        return Promise.resolve({});
      },
    });
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe('ai_disabled');
    expect(body.message).toMatch(/Settings/);
    expect(called).toBe(0);
  });

  it('ai_disabled when no service is configured', async () => {
    app = buildApp({ getOrGenerate: () => Promise.resolve({}) });
    await app.close();
    const ctx = { env: { adminPassword: null }, repos: { users: {}, settings: { getMerged: () => ({ aiCoachEnabled: true }) } }, ai: null } as unknown as AppContext;
    app = Fastify();
    registerRecommendationRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('ai_disabled');
  });
});
