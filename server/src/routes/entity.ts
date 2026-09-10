/**
 * GET /api/entity — the detail card behind any skill / subagent / tool / MCP
 * server / plugin name. Same range/team query contract as the analytics
 * endpoints; kind is allowlisted, name is only ever a bound parameter.
 */
import { ENTITY_KINDS, type EntityDetailResponse } from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { BadRequestError, parseRangeQuery, zodMessage } from './shared';

const entityQuerySchema = z.object({
  kind: z.enum(ENTITY_KINDS),
  name: z.string().min(1).max(500),
});

export function registerEntityRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/entity', async (req): Promise<EntityDetailResponse> => {
    const parsed = entityQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    const q = parseRangeQuery(req.query);
    return ctx.repos.entity.detail(parsed.data.kind, parsed.data.name, q.from, q.to, q.teamId);
  });
}
