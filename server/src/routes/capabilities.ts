import { capabilitiesFor, type CapabilitiesResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { APP_VERSION } from '../version';

export function registerCapabilityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/capabilities', async (): Promise<CapabilitiesResponse> => {
    const dataSource = ctx.env.dataSource;
    const capabilities = capabilitiesFor(dataSource);
    // The one data-driven override: an API-fed org that ALSO pointed devs'
    // OTel exporters here has real pack data — light the telemetry pages up.
    if (dataSource === 'console' || dataSource === 'enterprise') {
      const ingested = Number(ctx.repos.sync.getState('otel_events_ingested') ?? '0');
      if (Number.isFinite(ingested) && ingested > 0) capabilities.telemetryPacks = true;
    }
    return { dataSource, capabilities, privacyMode: ctx.env.privacyMode, version: APP_VERSION };
  });
}
