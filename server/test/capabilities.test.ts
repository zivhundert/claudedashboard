import Fastify, { type FastifyInstance } from 'fastify';
import type { AiCoachStatus, CapabilitiesResponse } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import { registerCapabilityRoutes } from '../src/routes/capabilities';

function buildApp(ai: { status: () => AiCoachStatus } | null): FastifyInstance {
  const ctx = {
    env: { dataSource: 'telemetry', privacyMode: 'balanced' },
    repos: { sync: { getState: () => null } },
    ai,
  } as unknown as AppContext;
  const app = Fastify();
  registerCapabilityRoutes(app, ctx);
  return app;
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe('GET /api/capabilities — aiCoach status', () => {
  it('reports reachable:false + lastError when the boot probe failed', async () => {
    const failed: AiCoachStatus = {
      enabled: true,
      model: 'gpt-5.6-luna',
      providerLabel: 'GPT-5.6 via LiteLLM',
      reachable: false,
      lastError: 'deployment "gpt-5.6-luna" does not exist at 172.17.0.1:3000 — create it or change FOUNDRY_MODEL',
      checkedAt: '2026-09-13T10:00:00.000Z',
    };
    app = buildApp({ status: () => failed });
    const res = await app.inject({ method: 'GET', url: '/api/capabilities' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CapabilitiesResponse;
    expect(body.capabilities.aiRecommendations).toBe(true);
    expect(body.aiCoach).toEqual(failed);
    expect(body.aiCoach.reachable).toBe(false);
    expect(body.aiCoach.lastError).toContain('does not exist');
  });

  it('reports the provider label and model when healthy', async () => {
    const ok: AiCoachStatus = {
      enabled: true,
      model: 'claude-opus-5',
      providerLabel: 'Claude on Microsoft Foundry',
      reachable: true,
      lastError: null,
      checkedAt: '2026-09-13T10:00:00.000Z',
    };
    app = buildApp({ status: () => ok });
    const body = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json() as CapabilitiesResponse;
    expect(body.aiCoach).toEqual(ok);
  });

  it('is the OFF shape when no key is configured', async () => {
    app = buildApp(null);
    const body = (await app.inject({ method: 'GET', url: '/api/capabilities' })).json() as CapabilitiesResponse;
    expect(body.capabilities.aiRecommendations).toBe(false);
    expect(body.aiCoach).toEqual({ enabled: false, model: null, providerLabel: null, reachable: null, lastError: null, checkedAt: null });
  });
});
