/**
 * OTLP/HTTP JSON receiver for Claude Code telemetry. Devs point their
 * exporter at this server:
 *
 *   export CLAUDE_CODE_ENABLE_TELEMETRY=1
 *   export OTEL_LOGS_EXPORTER=otlp
 *   export OTEL_METRICS_EXPORTER=otlp
 *   export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   export OTEL_EXPORTER_OTLP_ENDPOINT=http://<host>:<port>/otel
 *
 * <port> is PORT, or OTEL_PORT when the receiver runs on its own listener
 * (app.ts buildOtelApp). The exporter appends /v1/logs and /v1/metrics. Log events are aggregated
 * into otel_{skill,agent,tool}_daily; metrics land in usage_* (telemetry mode)
 * and the otel_* pack tables (every mode) — see otel/metrics.ts. Every record
 * passes the privacy policy (otel/privacy.ts) before any handler sees it, and
 * each request body is SHA-256-deduped for 15 minutes so exporter retries
 * never double-count. Everything parses defensively — malformed records are
 * skipped, never 500.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context';
import {
  attrsToMap,
  getBool,
  getNumber,
  getString,
  parseToolParameters,
  timeOfUnixNano,
  nowEventTime,
  EmailUserResolver,
  type AttrMap,
} from '../otel/common';
import { ingestMetricsPayload } from '../otel/metrics';
import { policyFor, sanitize } from '../otel/privacy';
import type {
  ActivityDailyDelta,
  ActivityHourlyDelta,
  AgentDelta,
  GovernanceDelta,
  McpDailyDelta,
  OtelIngestBatch,
  PermissionModeDelta,
  PluginDelta,
  ReliabilityDelta,
  SessionDelta,
  SkillDelta,
  ToolDelta,
} from '../repos/otelRepo';

declare module 'fastify' {
  interface FastifyRequest {
    /** SHA-256 hex of the raw request body — set by the /otel JSON parser. */
    rawBodySha256?: string;
  }
}

// ---------------------------------------------------------------------------
// Batch aggregation — one delta per (date, user, entity) per POST
// ---------------------------------------------------------------------------

const SEP = '\u0000';

/** 'YYYY-MM-DDTHH:00:00Z' hour bucket of a full ISO timestamp. */
function hourIsoOfIso(iso: string): string {
  return `${iso.slice(0, 13)}:00:00Z`;
}

class BatchAgg {
  readonly skills = new Map<string, SkillDelta>();
  readonly agents = new Map<string, AgentDelta>();
  readonly tools = new Map<string, ToolDelta>();
  readonly activityDaily = new Map<string, ActivityDailyDelta>();
  readonly activityHourly = new Map<string, ActivityHourlyDelta>();
  readonly reliability = new Map<string, ReliabilityDelta>();
  readonly governance = new Map<string, GovernanceDelta>();
  readonly permissionModes = new Map<string, PermissionModeDelta>();
  readonly mcp = new Map<string, McpDailyDelta>();
  readonly plugins = new Map<string, PluginDelta>();
  readonly sessions = new Map<string, SessionDelta>();
  eventsIngested = 0;
  eventsDropped = 0;
  maxEventAt: string | null = null;

  skill(date: string, userId: number, skillName: string): SkillDelta {
    const key = `${date}${SEP}${userId}${SEP}${skillName}`;
    let d = this.skills.get(key);
    if (!d) {
      d = { date, userId, skillName, invocations: 0, userSlash: 0, proactive: 0, nested: 0, costCents: 0 };
      this.skills.set(key, d);
    }
    return d;
  }

  agent(date: string, userId: number, subagentType: string): AgentDelta {
    const key = `${date}${SEP}${userId}${SEP}${subagentType}`;
    let d = this.agents.get(key);
    if (!d) {
      d = { date, userId, subagentType, invocations: 0, success: 0, failure: 0, costCents: 0 };
      this.agents.set(key, d);
    }
    return d;
  }

  tool(date: string, userId: number, toolName: string): ToolDelta {
    const key = `${date}${SEP}${userId}${SEP}${toolName}`;
    let d = this.tools.get(key);
    if (!d) {
      d = { date, userId, toolName, uses: 0, success: 0, failure: 0, accepted: 0, rejected: 0 };
      this.tools.set(key, d);
    }
    return d;
  }

  activity(date: string, userId: number): ActivityDailyDelta {
    const key = `${date}${SEP}${userId}`;
    let d = this.activityDaily.get(key);
    if (!d) {
      d = { date, userId, activeUserS: 0, activeCliS: 0, prompts: 0, sessions: 0 };
      this.activityDaily.set(key, d);
    }
    return d;
  }

  activityHour(userId: number, hourUtc: string): ActivityHourlyDelta {
    const key = `${userId}${SEP}${hourUtc}`;
    let d = this.activityHourly.get(key);
    if (!d) {
      d = { userId, hourUtc, prompts: 0, apiRequests: 0, sessionsStarted: 0 };
      this.activityHourly.set(key, d);
    }
    return d;
  }

  rel(date: string, userId: number, model: string): ReliabilityDelta {
    const key = `${date}${SEP}${userId}${SEP}${model}`;
    let d = this.reliability.get(key);
    if (!d) {
      d = {
        date,
        userId,
        model,
        apiRequests: 0,
        apiErrors: 0,
        errors429: 0,
        errors5xx: 0,
        errorsOther: 0,
        refusals: 0,
        compactions: 0,
        internalErrors: 0,
        totalDurationMs: 0,
      };
      this.reliability.set(key, d);
    }
    return d;
  }

  gov(date: string, userId: number): GovernanceDelta {
    const key = `${date}${SEP}${userId}`;
    let d = this.governance.get(key);
    if (!d) {
      d = {
        date,
        userId,
        srcConfig: 0,
        srcHook: 0,
        srcUserPermanent: 0,
        srcUserTemporary: 0,
        srcUserAbort: 0,
        srcUserReject: 0,
        permissionModeChanges: 0,
      };
      this.governance.set(key, d);
    }
    return d;
  }

  permissionMode(date: string, userId: number, mode: string): PermissionModeDelta {
    const key = `${date}${SEP}${userId}${SEP}${mode}`;
    let d = this.permissionModes.get(key);
    if (!d) {
      d = { date, userId, mode, changes: 0 };
      this.permissionModes.set(key, d);
    }
    return d;
  }

  mcpServer(date: string, userId: number, serverName: string): McpDailyDelta {
    const key = `${date}${SEP}${userId}${SEP}${serverName}`;
    let d = this.mcp.get(key);
    if (!d) {
      d = {
        date,
        userId,
        serverName,
        toolCalls: 0,
        toolFailures: 0,
        tokens: 0,
        costCents: 0,
        connections: 0,
        connectionFailures: 0,
      };
      this.mcp.set(key, d);
    }
    return d;
  }

  plugin(date: string, userId: number, pluginName: string): PluginDelta {
    const key = `${date}${SEP}${userId}${SEP}${pluginName}`;
    let d = this.plugins.get(key);
    if (!d) {
      d = { date, userId, pluginName, installs: 0, loads: 0 };
      this.plugins.set(key, d);
    }
    return d;
  }

  /** Track a session sighting; first/last event times extend as events arrive. */
  session(sessionId: string, userId: number, date: string, iso: string): SessionDelta {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { sessionId, userId, date, firstEventAt: iso, lastEventAt: iso, events: 0, prompts: 0 };
      this.sessions.set(sessionId, s);
    }
    if (iso < s.firstEventAt) {
      s.firstEventAt = iso;
      s.date = date; // date follows the earliest event
    }
    if (iso > s.lastEventAt) s.lastEventAt = iso;
    return s;
  }

  toBatch(): OtelIngestBatch {
    return {
      skills: [...this.skills.values()],
      agents: [...this.agents.values()],
      tools: [...this.tools.values()],
      activityDaily: [...this.activityDaily.values()],
      activityHourly: [...this.activityHourly.values()],
      reliability: [...this.reliability.values()],
      governance: [...this.governance.values()],
      permissionModes: [...this.permissionModes.values()],
      mcp: [...this.mcp.values()],
      plugins: [...this.plugins.values()],
      sessions: [...this.sessions.values()],
      eventsIngested: this.eventsIngested,
      eventsDropped: this.eventsDropped,
      maxEventAt: this.maxEventAt,
    };
  }
}

const RELEVANT_EVENTS = new Set([
  'claude_code.skill_activated',
  'claude_code.tool_result',
  'claude_code.tool_decision',
  'claude_code.api_request',
  'claude_code.user_prompt',
  'claude_code.api_error',
  'claude_code.api_refusal',
  'claude_code.compaction',
  'claude_code.internal_error',
  'claude_code.permission_mode_changed',
  'claude_code.mcp_server_connection',
  'claude_code.plugin_installed',
  'claude_code.plugin_loaded',
]);

/** tool_decision `source` attr → otel_governance_daily counter (unknown → ignored). */
const DECISION_SOURCE_FIELDS: Record<
  string,
  'srcConfig' | 'srcHook' | 'srcUserPermanent' | 'srcUserTemporary' | 'srcUserAbort' | 'srcUserReject'
> = {
  config: 'srcConfig',
  hook: 'srcHook',
  user_permanent: 'srcUserPermanent',
  user_temporary: 'srcUserTemporary',
  user_abort: 'srcUserAbort',
  user_reject: 'srcUserReject',
};

/**
 * Claude Code ≥2.x emits MCP calls with tool_name='mcp_tool' and the real
 * names inside tool_parameters ({mcp_server_name, mcp_tool_name}) — even with
 * OTEL_LOG_TOOL_DETAILS=1. Reconstruct the classic 'mcp__server__tool' so
 * per-server/per-tool attribution keeps working; older clients that still
 * send the full name pass through untouched.
 */
function resolveMcpToolName(toolName: string, params: Record<string, unknown> | null): string {
  if (toolName !== 'mcp_tool' || !params) return toolName;
  const server = params['mcp_server_name'];
  if (typeof server !== 'string' || server === '') return toolName;
  const tool = params['mcp_tool_name'];
  return `mcp__${server}__${typeof tool === 'string' && tool !== '' ? tool : 'unknown'}`;
}

/** 'mcp__jira__search' → 'jira'; fallback: whole suffix after 'mcp__'. */
function mcpServerOfToolName(toolName: string): string {
  const rest = toolName.slice('mcp__'.length);
  const sep = rest.indexOf('__');
  const server = sep > 0 ? rest.slice(0, sep) : rest;
  return server === '' ? 'unknown' : server;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function registerOtelRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // email → user id; survives across batches. Cleared on ingest failure so a
  // user merge that deleted a cached row cannot wedge the receiver.
  const resolver = new EmailUserResolver(ctx.repos.users);
  const policy = policyFor(ctx.env.privacyMode);

  /** true = authorized; otherwise a 401 has been sent. */
  const authorized = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const token = ctx.env.otelIngestToken;
    if (!token) return true;
    if (req.headers.authorization === `Bearer ${token}`) return true;
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  };

  /** One OTLP log record → aggregate deltas. Throws never (caller wraps). */
  const processRecord = (record: Record<string, unknown>, resourceAttrs: AttrMap, agg: BatchAgg): void => {
    const rawAttrs = attrsToMap(record['attributes']);

    // event identity: record attribute and/or body.stringValue
    const body = record['body'] as { stringValue?: unknown } | undefined;
    const bodyText = typeof body?.stringValue === 'string' ? body.stringValue : null;
    const attrName = getString(rawAttrs, 'event.name');
    const eventName = attrName && RELEVANT_EVENTS.has(attrName) ? attrName : bodyText && RELEVANT_EVENTS.has(bodyText) ? bodyText : null;
    if (!eventName) return; // unrelated event — ignore silently

    // THE privacy choke point: handlers below only ever see filtered attrs
    const attrs = sanitize(eventName, rawAttrs, policy);

    // record attrs first, resource attrs as fallback
    const email = getString(attrs, 'user.email') ?? getString(resourceAttrs, 'user.email');
    if (!email) {
      agg.eventsDropped += 1;
      return;
    }
    const userId = resolver.resolve(email);

    const time =
      timeOfUnixNano(record['timeUnixNano']) ??
      timeOfUnixNano(record['observedTimeUnixNano']) ??
      nowEventTime();
    const { date, iso } = time;
    const hourUtc = hourIsoOfIso(iso);

    // every relevant event with a session id feeds otel_sessions
    const sessionId = getString(attrs, 'session.id') ?? getString(resourceAttrs, 'session.id');
    const session = sessionId ? agg.session(sessionId, userId, date, iso) : null;
    if (session) session.events += 1;

    switch (eventName) {
      case 'claude_code.skill_activated': {
        const d = agg.skill(date, userId, getString(attrs, 'skill.name') ?? 'unknown');
        d.invocations += 1;
        const trigger = getString(attrs, 'invocation_trigger');
        if (trigger === 'user-slash') d.userSlash += 1;
        else if (trigger === 'claude-proactive') d.proactive += 1;
        else if (trigger === 'nested-skill') d.nested += 1;
        break;
      }
      case 'claude_code.tool_result': {
        const params = parseToolParameters(getString(attrs, 'tool_parameters'));
        const toolName = resolveMcpToolName(getString(attrs, 'tool_name') ?? 'unknown', params);
        const success = getBool(attrs, 'success');
        const t = agg.tool(date, userId, toolName);
        t.uses += 1;
        if (success === true) t.success += 1;
        else if (success === false) t.failure += 1;
        // Agent/Task carry the subagent in tool_parameters; Skill stays a
        // tool-only row — skill_activated is the source of truth for skills.
        if (toolName === 'Agent' || toolName === 'Task') {
          const sub = params && typeof params['subagent_type'] === 'string' && params['subagent_type'] !== ''
            ? (params['subagent_type'] as string)
            : 'unknown';
          const a = agg.agent(date, userId, sub);
          a.invocations += 1;
          if (success === true) a.success += 1;
          else if (success === false) a.failure += 1;
        }
        // MCP tools also feed the ecosystem pack (per-server call counters).
        // Minimal mode buckets tool_name to 'mcp_tool' (no 'mcp__' prefix), so
        // per-server attribution naturally disappears with the names.
        if (toolName.startsWith('mcp__')) {
          const m = agg.mcpServer(date, userId, mcpServerOfToolName(toolName));
          m.toolCalls += 1;
          if (success === false) m.toolFailures += 1;
        }
        break;
      }
      case 'claude_code.tool_decision': {
        const decisionParams = parseToolParameters(getString(attrs, 'tool_parameters'));
        const t = agg.tool(
          date,
          userId,
          resolveMcpToolName(getString(attrs, 'tool_name') ?? 'unknown', decisionParams),
        );
        const decision = getString(attrs, 'decision');
        if (decision === 'accept') t.accepted += 1;
        else if (decision === 'reject') t.rejected += 1;
        const source = getString(attrs, 'source');
        const field = source !== null ? DECISION_SOURCE_FIELDS[source] : undefined;
        if (field) agg.gov(date, userId)[field] += 1;
        break;
      }
      case 'claude_code.api_request': {
        const costUsd = getNumber(attrs, 'cost_usd');
        if (costUsd !== null && costUsd > 0) {
          const skillName = getString(attrs, 'skill.name');
          if (skillName) agg.skill(date, userId, skillName).costCents += costUsd * 100;
          const agentName = getString(attrs, 'agent.name');
          if (agentName) agg.agent(date, userId, agentName).costCents += costUsd * 100;
        }
        const r = agg.rel(date, userId, getString(attrs, 'model') ?? '');
        r.apiRequests += 1;
        const durationMs = getNumber(attrs, 'duration_ms');
        if (durationMs !== null && durationMs > 0) r.totalDurationMs += durationMs;
        agg.activityHour(userId, hourUtc).apiRequests += 1;
        break;
      }
      case 'claude_code.user_prompt': {
        agg.activity(date, userId).prompts += 1;
        agg.activityHour(userId, hourUtc).prompts += 1;
        if (session) session.prompts += 1;
        break;
      }
      case 'claude_code.api_error': {
        const r = agg.rel(date, userId, getString(attrs, 'model') ?? '');
        r.apiErrors += 1;
        const status = getNumber(attrs, 'status') ?? getNumber(attrs, 'status_code');
        if (status === 429) r.errors429 += 1;
        else if (status !== null && status >= 500 && status < 600) r.errors5xx += 1;
        else r.errorsOther += 1;
        break;
      }
      case 'claude_code.api_refusal': {
        agg.rel(date, userId, getString(attrs, 'model') ?? '').refusals += 1;
        break;
      }
      case 'claude_code.compaction': {
        agg.rel(date, userId, '').compactions += 1;
        break;
      }
      case 'claude_code.internal_error': {
        agg.rel(date, userId, '').internalErrors += 1;
        break;
      }
      case 'claude_code.permission_mode_changed': {
        agg.gov(date, userId).permissionModeChanges += 1;
        const mode =
          getString(attrs, 'mode') ??
          getString(attrs, 'to_mode') ??
          getString(attrs, 'permission_mode') ??
          'unknown';
        agg.permissionMode(date, userId, mode).changes += 1;
        break;
      }
      case 'claude_code.mcp_server_connection': {
        const success = getBool(attrs, 'success');
        const status = getString(attrs, 'status')?.toLowerCase() ?? null;
        // every session ends with a 'disconnected' event per server — lifecycle
        // noise, not a health signal; counting it as a failure flagged every
        // clean shutdown as a broken connection.
        if (status === 'disconnected' && success !== false) break;
        const serverName =
          getString(attrs, 'mcp_server.name') ?? getString(attrs, 'server_name') ?? 'unknown';
        const m = agg.mcpServer(date, userId, serverName);
        const failed =
          success === false ||
          (success === null && status !== null && ['failure', 'failed', 'error'].includes(status));
        if (failed) m.connectionFailures += 1;
        else m.connections += 1;
        break;
      }
      case 'claude_code.plugin_installed':
      case 'claude_code.plugin_loaded': {
        const pluginName =
          getString(attrs, 'plugin.name') ?? getString(attrs, 'plugin_name') ?? 'unknown';
        const p = agg.plugin(date, userId, pluginName);
        if (eventName === 'claude_code.plugin_installed') p.installs += 1;
        else p.loads += 1;
        break;
      }
    }

    agg.eventsIngested += 1;
    if (agg.maxEventAt === null || iso > agg.maxEventAt) agg.maxEventAt = iso;
  };

  /** Walk resourceLogs → scopeLogs → logRecords, skipping malformed nodes. */
  const buildAgg = (payload: unknown): BatchAgg => {
    const agg = new BatchAgg();
    if (typeof payload !== 'object' || payload === null) return agg;
    const resourceLogs = (payload as { resourceLogs?: unknown }).resourceLogs;
    if (!Array.isArray(resourceLogs)) return agg;
    for (const rl of resourceLogs) {
      if (typeof rl !== 'object' || rl === null) continue;
      const resource = (rl as { resource?: unknown }).resource as { attributes?: unknown } | undefined;
      const resourceAttrs = attrsToMap(resource?.attributes);
      const scopeLogs = (rl as { scopeLogs?: unknown }).scopeLogs;
      if (!Array.isArray(scopeLogs)) continue;
      for (const sl of scopeLogs) {
        if (typeof sl !== 'object' || sl === null) continue;
        const logRecords = (sl as { logRecords?: unknown }).logRecords;
        if (!Array.isArray(logRecords)) continue;
        for (const record of logRecords) {
          if (typeof record !== 'object' || record === null) continue;
          try {
            processRecord(record as Record<string, unknown>, resourceAttrs, agg);
          } catch (err) {
            app.log.warn({ err }, 'otel: skipped malformed log record');
          }
        }
      }
    }
    return agg;
  };

  // Scoped plugin: a JSON parser that also hashes the RAW body, so both /otel
  // endpoints can dedup exporter retries without changing parsing anywhere else.
  await app.register(async (scope) => {
    // A rejected batch is gone for good — the exporter has no disk buffer and a
    // retry of the same oversized body fails identically. Fastify's default
    // 1 MiB is far too small for a busy day with OTEL_LOG_TOOL_DETAILS=1, and
    // the loss looked like "I worked but the dashboard shows nothing".
    scope.setErrorHandler((err, req, reply) => {
      const code = (err as { code?: unknown }).code;
      const status = (err as { statusCode?: unknown }).statusCode;
      const tooLarge = code === 'FST_ERR_CTP_BODY_TOO_LARGE' || status === 413;
      ctx.repos.otel.bumpCounter(tooLarge ? 'otel_batch_too_large' : 'otel_batch_rejected', 1);
      req.log.error({ err, url: req.url }, 'otel: batch rejected — telemetry lost');
      // only Fastify's own 4xx is a client error; anything else is ours (500)
      const reported = typeof status === 'number' && status >= 400 ? status : 500;
      void reply.code(reported).send({ error: reported >= 500 ? 'internal_error' : 'rejected' });
    });

    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
      req.rawBodySha256 = createHash('sha256').update(body).digest('hex');
      try {
        done(null, body.length > 0 ? JSON.parse(body.toString('utf8')) : null);
      } catch {
        const err = new Error('invalid JSON body') as Error & { statusCode: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    });

    scope.post('/otel/v1/logs', { bodyLimit: ctx.env.otelMaxBodyBytes }, async (req, reply) => {
      if (!authorized(req, reply)) return reply;
      const hash = req.rawBodySha256;
      try {
        ctx.repos.otel.ingest(buildAgg(req.body).toBatch(), hash);
      } catch (err) {
        // e.g. a cached user id merged away mid-flight — reset and retry once
        req.log.warn({ err }, 'otel ingest failed, retrying with a cold user cache');
        resolver.clear();
        try {
          ctx.repos.otel.ingest(buildAgg(req.body).toBatch(), hash);
        } catch (err2) {
          req.log.error({ err: err2 }, 'otel ingest failed — batch skipped');
        }
      }
      return {};
    });

    scope.post('/otel/v1/metrics', { bodyLimit: ctx.env.otelMaxBodyBytes }, async (req, reply) => {
      if (!authorized(req, reply)) return reply;
      const hash = req.rawBodySha256 ?? null;
      try {
        ingestMetricsPayload(ctx, req.body, hash, resolver, policy);
      } catch (err) {
        req.log.warn({ err }, 'otel metrics ingest failed, retrying with a cold user cache');
        resolver.clear();
        try {
          ingestMetricsPayload(ctx, req.body, hash, resolver, policy);
        } catch (err2) {
          req.log.error({ err: err2 }, 'otel metrics ingest failed — batch skipped');
        }
      }
      return {};
    });
  });
}
