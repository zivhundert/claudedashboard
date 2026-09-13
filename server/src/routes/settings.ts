import { resolveTargets, type AppSettings } from '@dash/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { adminAuthorized } from './adminAuth';
import { parseBody } from './shared';

const targetNum = z.number().positive().finite();
const shareNum = z.number().positive().max(1).finite();
const hourNum = z.number().int().min(0).max(23);

// displayTimezone is deliberately absent: the zone comes from ORG_TIMEZONE, and
// an editable copy that nothing honoured is worse than no field at all.
const settingsPatchSchema = z.object({
  linesPerMinute: z.number().positive().optional(),
  hourlyRateUsd: z.number().nonnegative().optional(),
  seatCostUsdMonthly: z.number().nonnegative().optional(),
  inactiveDays: z.number().int().positive().optional(),
  decliningPct: z.number().min(0).max(100).optional(),
  // AI coach: the kill switch (off → on needs the admin password, see below) and the $/MTok rates
  aiCoachEnabled: z.boolean().optional(),
  aiCoachPriceInputUsdPerMTok: z.number().nonnegative().finite().optional(),
  aiCoachPriceOutputUsdPerMTok: z.number().nonnegative().finite().optional(),
  aiCoachPriceCacheReadUsdPerMTok: z.number().nonnegative().finite().optional(),
  // partial: unspecified targets keep their current value (deep-merged below)
  scoreTargets: z
    .object({
      perWorkday: z
        .object({
          sessions: targetNum,
          toolEvents: targetNum,
          linesAdded: targetNum,
          commits: targetNum,
          pullRequests: targetNum,
        })
        .partial()
        .optional(),
      flat: z
        .object({ linesPerSession: targetNum, linesPerDollar: targetNum })
        .partial()
        .optional(),
      timeBadges: z
        .object({
          nightShare: shareNum,
          earlyShare: shareNum,
          nightStartHour: hourNum,
          nightEndHour: hourNum,
          earlyStartHour: hourNum,
          earlyEndHour: hourNum,
          minActiveDays: z.number().int().positive(),
        })
        .partial()
        .optional(),
    })
    .optional(),
});

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The stored settings, with the zone overridden by ORG_TIMEZONE. */
  // scoreTargets is resolved on the way out too: rows persisted by an older
  // build predate whole target groups, and a shallow settings merge would hand
  // the client a half-populated object.
  const merged = (stored: AppSettings): AppSettings => ({
    ...stored,
    displayTimezone: ctx.env.orgTimezone,
    scoreTargets: resolveTargets(stored.scoreTargets),
  });

  app.get('/api/settings', async (): Promise<AppSettings> => merged(ctx.repos.settings.getMerged()));

  app.put('/api/settings', async (req, reply): Promise<AppSettings | FastifyReply> => {
    const patch = parseBody(settingsPatchSchema, req.body);
    // Anyone may switch the coach OFF (it spends money); switching it back ON
    // is the privileged direction and needs the admin password.
    if (patch.aiCoachEnabled === true && !ctx.repos.settings.getMerged().aiCoachEnabled) {
      if (!adminAuthorized(ctx, req, reply)) return reply;
      req.log.info('ai coach: re-enabled by admin');
    }
    if (patch.scoreTargets !== undefined) {
      // deep-merge the partial over what's currently effective, then store the
      // full resolved object — a stored value is always complete and valid
      const current = ctx.repos.settings.getMerged().scoreTargets;
      const effective = resolveTargets(current);
      const overCurrent = {
        perWorkday: { ...effective.perWorkday, ...patch.scoreTargets.perWorkday },
        flat: { ...effective.flat, ...patch.scoreTargets.flat },
        timeBadges: { ...effective.timeBadges, ...patch.scoreTargets.timeBadges },
      };
      patch.scoreTargets = resolveTargets(overCurrent);
    }
    return merged(ctx.repos.settings.setMany(patch as Partial<AppSettings>));
  });
}
