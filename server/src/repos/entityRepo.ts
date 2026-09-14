/**
 * Everything the pack tables know about one skill / subagent / tool / MCP
 * server / plugin (GET /api/entity). Each kind is an allowlisted spec — table,
 * name column, metrics — so the request only ever reaches SQL as bound params.
 */
import type { EntityDetailResponse, EntityFact, EntityKind, EntityRelated, EntityTotal } from '@dash/shared';
import type { Db } from '../db/connection';

interface MetricSpec {
  key: string;
  label: string;
  format: EntityTotal['format'];
  /** aggregate over alias t */
  sql: string;
}

interface KindSpec {
  table: string;
  nameCol: string;
  metrics: MetricSpec[];
  /** key of the metric charted per day */
  primary: string;
  primaryLabel: string;
}

const SPECS: Record<EntityKind, KindSpec> = {
  skill: {
    table: 'otel_skill_daily',
    nameCol: 'skill_name',
    primary: 'invocations',
    primaryLabel: 'invocations',
    metrics: [
      { key: 'invocations', label: 'Invocations', format: 'number', sql: 'SUM(t.invocations)' },
      { key: 'userSlash', label: 'Typed /', format: 'number', sql: 'SUM(t.user_slash)' },
      { key: 'proactive', label: 'Proactive', format: 'number', sql: 'SUM(t.proactive)' },
      { key: 'nested', label: 'Nested', format: 'number', sql: 'SUM(t.nested)' },
      { key: 'costCents', label: 'Cost', format: 'cents', sql: 'SUM(t.cost_cents)' },
    ],
  },
  agent: {
    table: 'otel_agent_daily',
    nameCol: 'subagent_type',
    primary: 'invocations',
    primaryLabel: 'runs',
    metrics: [
      { key: 'invocations', label: 'Runs', format: 'number', sql: 'SUM(t.invocations)' },
      { key: 'success', label: 'Succeeded', format: 'number', sql: 'SUM(t.success)' },
      { key: 'failure', label: 'Failed', format: 'number', sql: 'SUM(t.failure)' },
      { key: 'costCents', label: 'Cost', format: 'cents', sql: 'SUM(t.cost_cents)' },
    ],
  },
  tool: {
    table: 'otel_tool_daily',
    nameCol: 'tool_name',
    primary: 'uses',
    primaryLabel: 'uses',
    metrics: [
      { key: 'uses', label: 'Uses', format: 'number', sql: 'SUM(t.uses)' },
      { key: 'success', label: 'Succeeded', format: 'number', sql: 'SUM(t.success)' },
      { key: 'failure', label: 'Failed', format: 'number', sql: 'SUM(t.failure)' },
      { key: 'accepted', label: 'Accepted', format: 'number', sql: 'SUM(t.accepted)' },
      { key: 'rejected', label: 'Rejected', format: 'number', sql: 'SUM(t.rejected)' },
    ],
  },
  mcp: {
    table: 'otel_mcp_daily',
    nameCol: 'server_name',
    primary: 'toolCalls',
    primaryLabel: 'tool calls',
    metrics: [
      { key: 'toolCalls', label: 'Tool calls', format: 'number', sql: 'SUM(t.tool_calls)' },
      { key: 'toolFailures', label: 'Call failures', format: 'number', sql: 'SUM(t.tool_failures)' },
      { key: 'connections', label: 'Connections', format: 'number', sql: 'SUM(t.connections)' },
      { key: 'connectionFailures', label: 'Conn. failures', format: 'number', sql: 'SUM(t.connection_failures)' },
      { key: 'tokens', label: 'Tokens', format: 'number', sql: 'SUM(t.tokens)' },
      { key: 'costCents', label: 'Cost', format: 'cents', sql: 'SUM(t.cost_cents)' },
    ],
  },
  plugin: {
    table: 'otel_plugin_daily',
    nameCol: 'plugin_name',
    primary: 'loads',
    primaryLabel: 'loads',
    metrics: [
      { key: 'loads', label: 'Loads', format: 'number', sql: 'SUM(t.loads)' },
      { key: 'installs', label: 'Installs', format: 'number', sql: 'SUM(t.installs)' },
    ],
  },
};

const BUILTIN_TOOLS = new Set([
  'Agent', 'Bash', 'BashOutput', 'Edit', 'ExitPlanMode', 'Glob', 'Grep', 'KillShell', 'LS', 'MultiEdit',
  'NotebookEdit', 'NotebookRead', 'Read', 'Skill', 'SlashCommand', 'Task', 'TodoRead', 'TodoWrite',
  'WebFetch', 'WebSearch', 'Write',
]);

/** 'mcp__server__tool' → { server, tool }; null for non-MCP names. */
function splitMcp(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith('mcp__')) return null;
  const rest = toolName.slice(5);
  const sep = rest.indexOf('__');
  return sep > 0 ? { server: rest.slice(0, sep), tool: rest.slice(sep + 2) } : { server: rest, tool: rest };
}

/** skill.source values Claude Code emits (settings-scope names) → what a reviewer reads. */
const SOURCE_LABELS: Record<string, string> = {
  builtin: 'Built-in',
  bundled: 'Bundled with Claude Code',
  plugin: 'Plugin',
  userSettings: 'User skills folder (~/.claude/skills)',
  projectSettings: 'Project skills folder (.claude/skills, checked in)',
  localSettings: 'Project-local skills folder (.claude/skills, not checked in)',
  policySettings: 'Managed by the org (managed settings)',
  flagSettings: 'Passed on the command line (--settings)',
  // older / seed spellings
  user: 'User skills folder (~/.claude/skills)',
  project: 'Project skills folder (.claude/skills)',
  managed: 'Managed by the org',
};

function rate(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

/** allowed_tools is stored as JSON; a malformed row degrades to [] rather than throwing. */
function parseAllowedTools(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** SKILL.md frontmatter from the scanner (migration 011) — what no event carries. */
interface SkillCatalogRow {
  description: string;
  version: string | null;
  allowed_tools: string;
  model: string | null;
  path: string | null;
  reported_by: string | null;
  updated_at: string;
}

interface SkillMetaRow {
  source: string | null;
  kind: string | null;
  plugin_name: string | null;
  marketplace_name: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export class EntityRepo {
  constructor(private readonly db: Db) {}

  detail(kind: EntityKind, name: string, from: string, to: string, teamId?: number): EntityDetailResponse {
    const spec = SPECS[kind];
    const join = teamId !== undefined ? ' JOIN users u ON u.id = t.user_id' : '';
    const teamWhere = teamId !== undefined ? ' AND u.team_id = @teamId' : '';
    const params: Record<string, unknown> = { name, from, to };
    if (teamId !== undefined) params['teamId'] = teamId;

    const selects = spec.metrics.map((m) => `COALESCE(${m.sql}, 0) AS ${m.key}`).join(', ');
    const tot = this.db
      .prepare(
        `SELECT ${selects}, COUNT(DISTINCT t.user_id) AS users, COUNT(DISTINCT t.date) AS active_days
         FROM ${spec.table} t${join}
         WHERE t.${spec.nameCol} = @name AND t.date BETWEEN @from AND @to${teamWhere}`,
      )
      .get(params) as Record<string, number>;

    const life = this.db
      .prepare(
        `SELECT MIN(t.date) AS first_seen, MAX(t.date) AS last_seen
         FROM ${spec.table} t${join}
         WHERE t.${spec.nameCol} = @name${teamWhere}`,
      )
      .get(params) as { first_seen: string | null; last_seen: string | null };

    const primarySql = spec.metrics.find((m) => m.key === spec.primary)?.sql ?? 'COUNT(*)';
    const daily = (
      this.db
        .prepare(
          `SELECT t.date AS date, COALESCE(${primarySql}, 0) AS value
           FROM ${spec.table} t${join}
           WHERE t.${spec.nameCol} = @name AND t.date BETWEEN @from AND @to${teamWhere}
           GROUP BY t.date ORDER BY t.date`,
        )
        .all(params) as Array<{ date: string; value: number }>
    );

    const totals: EntityTotal[] = spec.metrics.map((m) => ({
      key: m.key,
      label: m.label,
      value: Number(tot[m.key] ?? 0),
      format: m.format,
    }));
    // derived rates the tables don't store
    const pushRate = (key: string, label: string, num: string, den: string[]) => {
      const n = Number(tot[num] ?? 0);
      const d = den.reduce((s, k) => s + Number(tot[k] ?? 0), 0);
      const r = rate(n, d);
      if (r !== null) totals.push({ key, label, value: r, format: 'pct' });
    };
    if (kind === 'agent') pushRate('successRate', 'Success rate', 'success', ['success', 'failure']);
    if (kind === 'tool') {
      pushRate('successRate', 'Success rate', 'success', ['success', 'failure']);
      pushRate('acceptanceRate', 'Acceptance', 'accepted', ['accepted', 'rejected']);
    }
    if (kind === 'mcp') pushRate('failureRate', 'Failure rate', 'toolFailures', ['toolCalls']);

    const { facts, related, relatedLabel } = this.context(kind, name, from, to, teamId);

    return {
      kind,
      name,
      range: { from, to },
      facts,
      totals,
      firstSeen: life.first_seen,
      lastSeen: life.last_seen,
      activeDays: Number(tot['active_days'] ?? 0),
      users: Number(tot['users'] ?? 0),
      dailyLabel: spec.primaryLabel,
      daily,
      relatedLabel,
      related,
    };
  }

  /** Static facts + neighbours, per kind. */
  private context(
    kind: EntityKind,
    name: string,
    from: string,
    to: string,
    teamId?: number,
  ): { facts: EntityFact[]; related: EntityRelated[]; relatedLabel: string | null } {
    const facts: EntityFact[] = [];
    const related: EntityRelated[] = [];
    let relatedLabel: string | null = null;
    const join = teamId !== undefined ? ' JOIN users u ON u.id = t.user_id' : '';
    const teamWhere = teamId !== undefined ? ' AND u.team_id = @teamId' : '';
    const params: Record<string, unknown> = { name, from, to };
    if (teamId !== undefined) params['teamId'] = teamId;

    switch (kind) {
      case 'skill': {
        facts.push({ label: 'Type', value: 'Skill' });
        const meta = this.db
          .prepare(`SELECT source, kind, plugin_name, marketplace_name, first_seen_at, last_seen_at FROM otel_skill_meta WHERE skill_name = ?`)
          .get(name) as SkillMetaRow | undefined;
        if (name === 'custom_skill' || name === 'third-party') {
          facts.push({ label: 'Name', value: 'Redacted — a bucket for skills whose names telemetry does not reveal' });
        }
        if (meta) {
          if (meta.source) facts.push({ label: 'Source', value: SOURCE_LABELS[meta.source] ?? meta.source });
          if (meta.kind) facts.push({ label: 'Definition', value: meta.kind });
          if (meta.plugin_name) facts.push({ label: 'Plugin', value: meta.plugin_name });
          if (meta.marketplace_name) facts.push({ label: 'Marketplace', value: meta.marketplace_name });
          facts.push({ label: 'Facts learned', value: `${meta.first_seen_at.slice(0, 10)} → ${meta.last_seen_at.slice(0, 10)}` });
          if (meta.plugin_name) {
            relatedLabel = 'Comes with plugin';
            const p = this.db
              .prepare(
                `SELECT COALESCE(SUM(t.loads), 0) AS v FROM otel_plugin_daily t${join}
                 WHERE t.plugin_name = @plugin AND t.date BETWEEN @from AND @to${teamWhere}`,
              )
              .get({ ...params, plugin: meta.plugin_name }) as { v: number };
            related.push({ kind: 'plugin', name: meta.plugin_name, value: Number(p.v) });
          }
        } else {
          facts.push({ label: 'Source', value: 'Unknown — no skill_activated event carried source details yet' });
        }
        // Frontmatter facts: description, version, allowed-tools and path exist
        // only in the SKILL.md on disk, so they arrive via `pnpm skills:scan`
        // rather than telemetry. Absent until someone runs it — a quiet gap,
        // not an error, so nothing is pushed when there is no row.
        const cat = this.db
          .prepare(
            `SELECT description, version, allowed_tools, model, path, reported_by, updated_at
               FROM skill_catalog WHERE name = ? ORDER BY updated_at DESC LIMIT 1`,
          )
          .get(name) as SkillCatalogRow | undefined;
        if (cat) {
          if (cat.description) facts.push({ label: 'Description', value: cat.description });
          if (cat.version) facts.push({ label: 'Version', value: cat.version });
          if (cat.model) facts.push({ label: 'Model', value: cat.model });
          const tools = parseAllowedTools(cat.allowed_tools);
          if (tools.length > 0) facts.push({ label: 'Allowed tools', value: tools.join(', ') });
          if (cat.path) facts.push({ label: 'Path', value: cat.path });
          facts.push({
            label: 'Catalog scan',
            value: `${cat.updated_at.slice(0, 10)}${cat.reported_by ? ` · ${cat.reported_by}` : ''}`,
          });
        }
        break;
      }
      case 'agent': {
        facts.push({ label: 'Type', value: 'Subagent' });
        facts.push({ label: 'Invoked via', value: 'Agent / Task tool, subagent_type parameter' });
        break;
      }
      case 'tool': {
        const mcp = splitMcp(name);
        if (mcp) {
          facts.push({ label: 'Type', value: 'MCP tool' });
          facts.push({ label: 'Tool', value: mcp.tool });
          facts.push({ label: 'Server', value: mcp.server });
          relatedLabel = 'Served by';
          const s = this.db
            .prepare(
              `SELECT COALESCE(SUM(t.tool_calls), 0) AS v FROM otel_mcp_daily t${join}
               WHERE t.server_name = @server AND t.date BETWEEN @from AND @to${teamWhere}`,
            )
            .get({ ...params, server: mcp.server }) as { v: number };
          related.push({ kind: 'mcp', name: mcp.server, value: Number(s.v) });
        } else if (name === 'mcp_tool') {
          facts.push({ label: 'Type', value: 'MCP tool (name redacted by telemetry settings)' });
        } else {
          facts.push({ label: 'Type', value: BUILTIN_TOOLS.has(name) ? 'Built-in Claude Code tool' : 'Tool' });
        }
        break;
      }
      case 'mcp': {
        facts.push({ label: 'Type', value: 'MCP server' });
        relatedLabel = 'Tools called';
        const prefix = `mcp__${name}__`;
        const rows = this.db
          .prepare(
            `SELECT t.tool_name AS n, COALESCE(SUM(t.uses), 0) AS v FROM otel_tool_daily t${join}
             WHERE substr(t.tool_name, 1, @len) = @prefix AND t.date BETWEEN @from AND @to${teamWhere}
             GROUP BY t.tool_name ORDER BY v DESC`,
          )
          .all({ ...params, prefix, len: prefix.length }) as Array<{ n: string; v: number }>;
        for (const r of rows) related.push({ kind: 'tool', name: r.n, value: Number(r.v) });
        facts.push({ label: 'Distinct tools', value: String(rows.length) });
        break;
      }
      case 'plugin': {
        facts.push({ label: 'Type', value: 'Plugin' });
        const mk = this.db
          .prepare(`SELECT marketplace_name FROM otel_skill_meta WHERE plugin_name = ? AND marketplace_name IS NOT NULL LIMIT 1`)
          .get(name) as { marketplace_name: string } | undefined;
        if (mk) facts.push({ label: 'Marketplace', value: mk.marketplace_name });
        relatedLabel = 'Skills it provides';
        const rows = this.db
          .prepare(
            `SELECT m.skill_name AS n, COALESCE(SUM(t.invocations), 0) AS v
             FROM otel_skill_meta m
             LEFT JOIN otel_skill_daily t ON t.skill_name = m.skill_name AND t.date BETWEEN @from AND @to
             ${teamId !== undefined ? 'LEFT JOIN users u ON u.id = t.user_id' : ''}
             WHERE m.plugin_name = @name${teamId !== undefined ? ' AND (u.team_id = @teamId OR t.user_id IS NULL)' : ''}
             GROUP BY m.skill_name ORDER BY v DESC`,
          )
          .all(params) as Array<{ n: string; v: number }>;
        for (const r of rows) related.push({ kind: 'skill', name: r.n, value: Number(r.v) });
        break;
      }
    }
    return { facts, related, relatedLabel };
  }
}
