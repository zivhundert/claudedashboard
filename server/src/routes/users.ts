import {
  COUNTRY_CODES,
  addDays,
  type CalendarDay,
  type ModelUsage,
  type TimeseriesPoint,
  type TimeseriesResponse,
  type UserProfileResponse,
  type UsersResponse,
} from '@dash/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { toUserDto, type UserRow } from '../repos/userRepo';
import { buildLeaderboardData, entryForUser } from '../services/scoring';
import { todayLocal } from '../util/time';
import { parseBody, parseRangeQuery, rangeQuerySchema, zodMessage, BadRequestError } from './shared';

export function findUser(ctx: AppContext, idOrEmail: string): UserRow | undefined {
  if (idOrEmail.includes('@')) {
    return ctx.repos.users.getByEmail(idOrEmail);
  }
  const id = Number(idOrEmail);
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return ctx.repos.users.getById(id);
}

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/users', async (): Promise<UsersResponse> => {
    return { users: ctx.repos.users.listAll().map(toUserDto) };
  });

  app.get('/api/users/:idOrEmail/profile', async (req, reply) => {
    const { idOrEmail } = req.params as { idOrEmail: string };
    const q = parseRangeQuery(req.query);
    const user = findUser(ctx, idOrEmail);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    const data = buildLeaderboardData(ctx.repos, { from: q.from, to: q.to });
    const entry = entryForUser(data, user.id);
    if (!entry) return reply.code(404).send({ error: 'user_not_found' });

    const models: ModelUsage[] = ctx.repos.usage.modelTotals(q.from, q.to, undefined, user.id).map((r) => ({
      model: r.model,
      tokens: {
        input: r.input_tokens,
        output: r.output_tokens,
        cacheRead: r.cache_read_tokens,
        cacheCreation: r.cache_creation_tokens,
      },
      costCents: r.cost_cents,
    }));

    // trailing 365 days regardless of the range filter
    const today = todayLocal();
    const calFrom = addDays(today, -364);
    const coreByDate = new Map(ctx.repos.usage.calendarCore(user.id, calFrom, today).map((r) => [r.date, r]));
    const costByDate = new Map(
      ctx.repos.usage.calendarCost(user.id, calFrom, today).map((r) => [r.date, r.cost_cents]),
    );
    const calendar: CalendarDay[] = [];
    for (let date = calFrom; date <= today; date = addDays(date, 1)) {
      const core = coreByDate.get(date);
      calendar.push({
        date,
        sessions: core?.sessions ?? 0,
        netLines: core?.net_lines ?? 0,
        costCents: costByDate.get(date) ?? 0,
      });
    }

    const terminalMix = ctx.repos.usage.terminalMix(q.from, q.to, { userId: user.id }).map((r) => ({
      terminalType: r.terminal_type,
      sessions: r.sessions,
    }));

    const response: UserProfileResponse = {
      user: toUserDto(user),
      range: { from: q.from, to: q.to },
      entry,
      models,
      calendar,
      terminalMix,
      lastActiveAt: ctx.repos.usage.lastActiveAt(user.id),
      tokensDaily: ctx.repos.usage.tokensDaily(user.id, q.from, q.to).map((r) => ({
        date: r.date,
        input: r.input_tokens,
        output: r.output_tokens,
        cacheRead: r.cache_read_tokens,
        cacheCreation: r.cache_creation_tokens,
        costCents: r.cost_cents,
      })),
    };
    return response;
  });

  app.get('/api/users/:idOrEmail/timeseries', async (req, reply) => {
    const { idOrEmail } = req.params as { idOrEmail: string };
    const splitSchema = rangeQuerySchema.extend({
      split: z.enum(['none', 'terminal', 'model']).optional(),
    });
    const parsed = splitSchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    const q = parseRangeQuery(req.query);
    const split = parsed.data.split ?? 'none';

    const user = findUser(ctx, idOrEmail);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });

    const rows =
      split === 'model'
        ? ctx.repos.usage.timeseriesByModel(user.id, q.from, q.to)
        : ctx.repos.usage.timeseries(user.id, q.from, q.to, split);

    const points: TimeseriesPoint[] = rows.map((r) => ({
      date: r.date,
      key: r.key,
      sessions: r.sessions,
      linesAdded: r.lines_added,
      linesRemoved: r.lines_removed,
      commits: r.commits,
      pullRequests: r.pull_requests,
      toolAccepted: r.tool_accepted,
      toolRejected: r.tool_rejected,
      costCents: r.cost_cents,
    }));

    const response: TimeseriesResponse = {
      range: { from: q.from, to: q.to },
      split,
      points,
    };
    return response;
  });

  app.put('/api/users/:id/team', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    const body = parseBody(z.object({ teamId: z.number().int().positive().nullable() }), req.body);
    const user = ctx.repos.users.getById(userId);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    if (user.actor_type !== 'user') {
      return reply.code(400).send({ error: 'cannot_assign_api_key_actor' });
    }
    if (body.teamId !== null && !ctx.repos.teams.get(body.teamId)) {
      return reply.code(404).send({ error: 'team_not_found' });
    }
    ctx.repos.users.setTeam(userId, body.teamId);
    const updated = ctx.repos.users.getById(userId);
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    return toUserDto(updated);
  });

  app.put('/api/users/:id/country', async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = Number(id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return reply.code(404).send({ error: 'user_not_found' });
    }
    const body = parseBody(
      z.object({ country: z.enum(COUNTRY_CODES as unknown as [string, ...string[]]).nullable() }),
      req.body,
    );
    const user = ctx.repos.users.getById(userId);
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    if (user.actor_type !== 'user') {
      return reply.code(400).send({ error: 'cannot_locate_api_key_actor' });
    }
    ctx.repos.users.setCountry(userId, body.country);
    const updated = ctx.repos.users.getById(userId);
    if (!updated) return reply.code(404).send({ error: 'user_not_found' });
    return toUserDto(updated);
  });
}
