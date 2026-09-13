/**
 * GET  /api/users/:idOrEmail/recommendations?from&to            — cached or fresh coaching notes
 * POST /api/users/:idOrEmail/recommendations/regenerate?from&to — force a new generation (rate-limited)
 * GET  /api/coach/prompt                                        — built-in + custom guidance, locked contract
 * PUT  /api/coach/prompt  { guidance: string | null }           — admin only (x-admin-password header)
 *
 * 404 ai_disabled when no Foundry key is configured (the web hides the card
 * via /api/capabilities first, so this is a belt-and-braces answer).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { CoachPromptResponse, RecommendationsResponse } from '@dash/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { MAX_GUIDANCE_CHARS, getCoachPrompt, setCoachGuidance } from '../services/coachPrompt';
import { AiUpstreamError, RateLimitedError } from '../services/recommendations';
import { parseBody, parseRangeQuery } from './shared';
import { findUser } from './users';

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

/** true when the request carries the admin password; otherwise the 401/403 has been sent. */
function adminAuthorized(ctx: AppContext, req: FastifyRequest, reply: FastifyReply): boolean {
  if (!ctx.env.adminPassword) {
    void reply.code(403).send({ error: 'admin_password_not_configured', message: 'Set ADMIN_PASSWORD on the server to allow this edit' });
    return false;
  }
  const given = req.headers['x-admin-password'];
  const value = Array.isArray(given) ? given[0] : given;
  if (typeof value !== 'string' || !timingSafeEqual(sha(value), sha(ctx.env.adminPassword))) {
    void reply.code(401).send({ error: 'unauthorized', message: 'Wrong admin password' });
    return false;
  }
  return true;
}

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

  const promptInfo = (): CoachPromptResponse =>
    getCoachPrompt(ctx.repos, { enabled: ctx.ai !== null, adminConfigured: ctx.env.adminPassword !== null });

  app.get('/api/coach/prompt', async (): Promise<CoachPromptResponse> => promptInfo());

  app.put('/api/coach/prompt', async (req, reply): Promise<CoachPromptResponse | FastifyReply> => {
    if (!adminAuthorized(ctx, req, reply)) return reply;
    const body = parseBody(
      z.object({ guidance: z.string().trim().min(40).max(MAX_GUIDANCE_CHARS).nullable() }),
      req.body,
    );
    setCoachGuidance(ctx.repos, body.guidance);
    req.log.info({ custom: body.guidance !== null, chars: body.guidance?.length ?? 0 }, 'ai coach: prompt updated by admin; cache cleared');
    return promptInfo();
  });
}
