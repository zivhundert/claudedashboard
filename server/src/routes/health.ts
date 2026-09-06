import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { APP_VERSION } from '../version';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async () => ({
    ok: true,
    version: APP_VERSION,
    demoMode: ctx.env.demoMode,
    lastSync: ctx.repos.sync.dataFreshAt(),
  }));
}
