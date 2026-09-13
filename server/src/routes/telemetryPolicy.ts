import type { TelemetryPolicyResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { policyFor } from '../otel/privacy';

/**
 * Transparency endpoint: the EXACT policy object the ingest choke point
 * executes (otel/privacy.ts) — what this returns is what happens to the data.
 * When the AI coach is on, its note is appended so the "What's collected"
 * page also says where numbers go OUT.
 */
export function registerTelemetryPolicyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/telemetry-policy', async (): Promise<TelemetryPolicyResponse> => {
    const policy = policyFor(ctx.env.privacyMode);
    if (!ctx.env.ai) return policy;
    return {
      ...policy,
      notes: [
        ...policy.notes,
        `AI coach is on: when someone opens a Personal page, that person's metrics (numbers only — never prompts, code or file names) are sent to Claude on Microsoft Foundry (${ctx.env.ai.model}) to write recommendations; results are cached up to ${ctx.env.ai.ttlHours}h`,
      ],
    };
  });
}
