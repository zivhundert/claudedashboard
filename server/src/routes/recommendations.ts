/**
 * GET  /api/users/:idOrEmail/recommendations?from&to            — cached or fresh coaching notes
 * POST /api/users/:idOrEmail/recommendations/regenerate?from&to — force a new generation (rate-limited)
 *
 * 404 ai_disabled when no Foundry key is configured (the web hides the card
 * via /api/capabilities first, so this is a belt-and-braces answer).
 */
import type { RecommendationsResponse } from '@dash/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import { AiUpstreamError, RateLimitedError } from '../services/recommendations';
import { parseRangeQuery } from './shared';
import { findUser } from './users';

export function registerRecommendationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const handle = async (req: FastifyRequest, reply: FastifyReply, force: boolean): Promise<RecommendationsResponse | FastifyReply> => {
    if (!ctx.ai) return reply.code(404).send({ error: 'ai_disabled', message: 'No Foundry key configured' });
    const { idOrEmail } = req.params as { idOrEmail: string };
    const user = findUser(ctx, idOrEmail);
    if (!user || user.actor_type !== 'user') return reply.code(404).send({ error: 'user_not_found' });
    const q = parseRangeQuery(req.query);
    try {
      return await ctx.ai.getOrGenerate(user.id, { from: q.from, to: q.to }, { force });
    } catch (err) {
      if (err instanceof RateLimitedError) {
        return reply
          .code(429)
          .header('Retry-After', String(err.retryAfterSec))
          .send({ error: 'rate_limited', message: err.message, retryAfterSec: err.retryAfterSec });
      }
      if (err instanceof AiUpstreamError) {
        if (err.status === 404) return reply.code(404).send({ error: 'user_not_found' });
        return reply.code(502).send({ error: 'ai_upstream_error', message: err.message });
      }
      throw err;
    }
  };

  app.get('/api/users/:idOrEmail/recommendations', (req, reply) => handle(req, reply, false));
  app.post('/api/users/:idOrEmail/recommendations/regenerate', (req, reply) => handle(req, reply, true));
}
