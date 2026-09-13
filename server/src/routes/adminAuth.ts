/**
 * The one privileged gate the dashboard has: an admin password from the
 * server's .env, sent as the x-admin-password header and compared in constant
 * time. Used by the coach prompt editor and by re-enabling the AI coach.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';

const sha = (s: string): Buffer => createHash('sha256').update(s).digest();

/** true when the request carries the admin password; otherwise the 401/403 has been sent. */
export function adminAuthorized(ctx: AppContext, req: FastifyRequest, reply: FastifyReply): boolean {
  if (!ctx.env.adminPassword) {
    void reply.code(403).send({ error: 'admin_password_not_configured', message: 'Set ADMIN_PASSWORD on the server to allow this change' });
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
