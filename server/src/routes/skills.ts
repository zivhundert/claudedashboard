import {
  SKILL_SOURCES,
  type AgentUsageRow,
  type SkillCatalogResponse,
  type SkillCatalogUploadResult,
  type SkillsResponse,
  type SkillUsageRow,
  type ToolUsageRow,
  type UserSkillRow,
} from '@dash/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { OtelScope } from '../repos/otelRepo';
import { parseBody, parseRangeQuery, rangeQuerySchema, zodMessage, BadRequestError } from './shared';

const TOOL_CAP = 25;
/** One scanner run reports a whole machine's skills; well past any real install. */
const CATALOG_MAX_ENTRIES = 2000;

const skillsQuerySchema = rangeQuerySchema.extend({
  /** scopes skills/agents/tools to one user; users[] comes back empty */
  userId: z.coerce.number().int().positive().optional(),
});

/** Frontmatter is author-controlled text — every field is length-capped here. */
const catalogEntrySchema = z.object({
  name: z.string().min(1).max(120),
  source: z.enum(SKILL_SOURCES),
  pluginName: z.string().max(120).optional(),
  description: z.string().max(2000).optional(),
  version: z.string().max(60).nullish(),
  allowedTools: z.array(z.string().max(120)).max(100).optional(),
  model: z.string().max(80).nullish(),
  path: z.string().max(400).nullish(),
});

const catalogUploadSchema = z.object({
  reportedBy: z.string().min(1).max(120).optional(),
  entries: z.array(catalogEntrySchema).max(CATALOG_MAX_ENTRIES),
  replaceReporter: z.boolean().optional(),
});

function rate(success: number, failure: number): number | null {
  const total = success + failure;
  return total > 0 ? success / total : null;
}

export function registerSkillRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/skills', async (req): Promise<SkillsResponse> => {
    const parsed = skillsQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) throw new BadRequestError(zodMessage(parsed.error));
    const q = parseRangeQuery(req.query);
    const userId = parsed.data.userId;

    const scope: OtelScope = {};
    if (q.teamId !== undefined) scope.teamId = q.teamId;
    if (userId !== undefined) scope.userId = userId;

    const skills: SkillUsageRow[] = ctx.repos.otel.skillTotals(q.from, q.to, scope).map((r) => ({
      skillName: r.skill_name,
      invocations: r.invocations,
      users: r.users,
      costCents: r.cost_cents,
      userSlash: r.user_slash,
      proactive: r.proactive,
      nested: r.nested,
    }));

    const agents: AgentUsageRow[] = ctx.repos.otel.agentTotals(q.from, q.to, scope).map((r) => ({
      subagentType: r.subagent_type,
      invocations: r.invocations,
      users: r.users,
      successRate: rate(r.success, r.failure),
      costCents: r.cost_cents,
    }));

    const tools: ToolUsageRow[] = ctx.repos.otel.toolTotals(q.from, q.to, scope, TOOL_CAP).map((r) => ({
      toolName: r.tool_name,
      uses: r.uses,
      accepted: r.accepted,
      rejected: r.rejected,
      successRate: rate(r.success, r.failure),
    }));

    // per-user rollup only makes sense org/team-wide
    const users: UserSkillRow[] =
      userId !== undefined
        ? []
        : ctx.repos.otel.userRollup(q.from, q.to, scope).map((r) => ({
            userId: r.user_id,
            name: r.name,
            email: r.email,
            skillInvocations: r.skill_invocations,
            distinctSkills: r.distinct_skills,
            agentInvocations: r.agent_invocations,
            topSkill: r.top_skill,
          }));

    const eventsIngested = Number(ctx.repos.sync.getState('otel_events_ingested') ?? '0');

    return {
      range: { from: q.from, to: q.to },
      hasData: ctx.repos.otel.hasData(q.from, q.to, scope),
      totals: ctx.repos.otel.totals(q.from, q.to, scope),
      skills,
      agents,
      tools,
      users,
      ingest: {
        eventsIngested: Number.isFinite(eventsIngested) ? eventsIngested : 0,
        lastEventAt: ctx.repos.sync.getState('otel_last_event_at'),
      },
    };
  });

  // -------------------------------------------------------------------------
  // Skill catalog — the metadata telemetry cannot carry. Read is open like the
  // rest of the dashboard API; writes reuse OTEL_INGEST_TOKEN, because the
  // uploader is the same fleet of dev machines that pushes OTLP and a second
  // secret to distribute would only be a second secret to leak.
  // -------------------------------------------------------------------------

  const authorizedToWrite = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const token = ctx.env.otelIngestToken;
    if (!token) return true;
    if (req.headers.authorization === `Bearer ${token}`) return true;
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  };

  app.get('/api/skills/catalog', async (): Promise<SkillCatalogResponse> => ({
    entries: ctx.repos.skillCatalog.list(),
    lastUpdatedAt: ctx.repos.skillCatalog.lastUpdatedAt(),
  }));

  app.post('/api/skills/catalog', async (req, reply): Promise<SkillCatalogUploadResult | undefined> => {
    if (!authorizedToWrite(req, reply)) return undefined;
    const body = parseBody(catalogUploadSchema, req.body);
    if (body.replaceReporter && body.reportedBy === undefined) {
      throw new BadRequestError('replaceReporter requires reportedBy');
    }
    const { upserted, deleted } = ctx.repos.skillCatalog.upsertBatch(
      body.entries,
      body.reportedBy ?? null,
      body.replaceReporter ?? false,
    );
    return { upserted, deleted, total: ctx.repos.skillCatalog.list().length };
  });
}
