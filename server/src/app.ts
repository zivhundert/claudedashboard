import fs from 'node:fs';
import path from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context';
import { registerAdoptionRoutes } from './routes/adoption';
import { registerApiKeyRoutes } from './routes/apiKeys';
import { registerBreakdownRoutes } from './routes/breakdown';
import { registerCapabilityRoutes } from './routes/capabilities';
import { registerCostRoutes } from './routes/costs';
import { registerDimensionRoutes } from './routes/dimensions';
import { registerEntityRoutes } from './routes/entity';
import { registerHealthRoutes } from './routes/health';
import { registerHeatmapRoutes } from './routes/heatmap';
import { registerInsightRoutes } from './routes/insights';
import { registerLeaderboardRoutes } from './routes/leaderboard';
import { registerOtelRoutes } from './routes/otel';
import { registerOverviewRoutes } from './routes/overview';
import { registerSettingsRoutes } from './routes/settings';
import { registerSkillRoutes } from './routes/skills';
import { registerSyncRoutes } from './routes/sync';
import { registerTeamRoutes } from './routes/teams';
import { registerTelemetryPackRoutes } from './routes/telemetryPacks';
import { registerTelemetryPolicyRoutes } from './routes/telemetryPolicy';
import { registerUserRoutes } from './routes/users';
import { registerRecommendationRoutes } from './routes/recommendations';
import { BadRequestError } from './routes/shared';

function createServer(): FastifyInstance {
  return Fastify({
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
  });
}

/** Uniform JSON error envelope; shared by the dashboard app and the OTLP listener. */
function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof BadRequestError) {
      void reply.code(400).send({ error: 'bad_request', message: err.message });
      return;
    }
    const maybe = err as { statusCode?: unknown; message?: unknown };
    const statusCode = typeof maybe.statusCode === 'number' && maybe.statusCode >= 400 ? maybe.statusCode : 500;
    if (statusCode >= 500) req.log.error(err);
    void reply.code(statusCode).send({
      error: statusCode >= 500 ? 'internal_error' : 'request_error',
      message: typeof maybe.message === 'string' ? maybe.message : 'unexpected error',
    });
  });
}

/**
 * The dashboard: API + (in production) the built SPA. The OTLP receiver rides
 * along on the same listener unless OTEL_PORT moves it to `buildOtelApp`.
 */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = createServer();

  // Tee sync log lines to stdout too (the live window is the in-memory buffer).
  ctx.syncLog.setLogger(app.log);
  ctx.ai?.setLogger(app.log);

  installErrorHandler(app);

  await app.register(cors, { origin: true });

  registerHealthRoutes(app, ctx);
  registerCapabilityRoutes(app, ctx);
  registerTelemetryPolicyRoutes(app, ctx);
  registerOverviewRoutes(app, ctx);
  registerLeaderboardRoutes(app, ctx);
  registerUserRoutes(app, ctx);
  registerRecommendationRoutes(app, ctx);
  registerTeamRoutes(app, ctx);
  registerHeatmapRoutes(app, ctx);
  registerInsightRoutes(app, ctx);
  registerCostRoutes(app, ctx);
  registerApiKeyRoutes(app, ctx);
  registerDimensionRoutes(app, ctx);
  registerAdoptionRoutes(app, ctx);
  registerSkillRoutes(app, ctx);
  registerTelemetryPackRoutes(app, ctx);
  registerBreakdownRoutes(app, ctx);
  registerEntityRoutes(app, ctx);
  if (ctx.env.otelPort === null) {
    await registerOtelRoutes(app, ctx); // OTLP receiver — must precede the SPA fallback
  }
  registerSyncRoutes(app, ctx);
  registerSettingsRoutes(app, ctx);

  // Static SPA hosting — skipped gracefully when the web build is absent (dev).
  const distPath = path.resolve(ctx.env.webDistPath);
  const hasWebDist = fs.existsSync(path.join(distPath, 'index.html'));
  if (hasWebDist) {
    await app.register(fastifyStatic, { root: distPath });
  } else {
    app.log.info(`web dist not found at ${distPath} — serving API only`);
  }

  app.setNotFoundHandler((req, reply) => {
    if (hasWebDist && req.method === 'GET' && !req.url.startsWith('/api')) {
      return reply.sendFile('index.html'); // SPA fallback
    }
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}

/**
 * Standalone OTLP receiver for OTEL_PORT: only POST /otel/v1/{logs,metrics},
 * no CORS, no SPA. Shares the repos/context with the dashboard app so both
 * write the same SQLite database.
 */
export async function buildOtelApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = createServer();
  installErrorHandler(app);
  await registerOtelRoutes(app, ctx);
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'not_found' }));
  return app;
}
