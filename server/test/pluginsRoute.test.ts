/**
 * GET /api/telemetry/plugins — plugins ranked by their skills' runs, each with
 * its own skill breakdown. Runs against a real, fully migrated in-memory DB so
 * the attribution rules are proven on the actual schema.
 */
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PluginsResponse } from '@dash/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext } from '../src/context';
import type { Db } from '../src/db/connection';
import { migrate } from '../src/db/migrate';
import { OtelPacksRepo } from '../src/repos/otelPacksRepo';
import { OtelRepo } from '../src/repos/otelRepo';
import { registerTelemetryPackRoutes } from '../src/routes/telemetryPacks';

const RANGE = 'from=2026-10-01&to=2026-10-31';

function addUser(db: Db, email: string, teamId: number | null = null): number {
  return Number(
    db.prepare(`INSERT INTO users (actor_type, email, name, team_id) VALUES ('user', ?, ?, ?)`).run(email, email, teamId)
      .lastInsertRowid,
  );
}

function skill(db: Db, date: string, userId: number, name: string, invocations: number, costCents = 0): void {
  db.prepare(
    `INSERT INTO otel_skill_daily (date, user_id, skill_name, invocations, cost_cents) VALUES (?, ?, ?, ?, ?)`,
  ).run(date, userId, name, invocations, costCents);
}

function meta(db: Db, name: string, pluginName: string | null): void {
  db.prepare(
    `INSERT INTO otel_skill_meta (skill_name, source, plugin_name, first_seen_at, last_seen_at)
     VALUES (?, 'plugin', ?, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
  ).run(name, pluginName);
}

function load(db: Db, date: string, userId: number, pluginName: string, loads: number, installs = 0): void {
  db.prepare(`INSERT INTO otel_plugin_daily (date, user_id, plugin_name, installs, loads) VALUES (?, ?, ?, ?, ?)`).run(
    date,
    userId,
    pluginName,
    installs,
    loads,
  );
}

function mcp(db: Db, date: string, userId: number, server: string, calls: number): void {
  db.prepare(`INSERT INTO otel_mcp_daily (date, user_id, server_name, tool_calls) VALUES (?, ?, ?, ?)`).run(
    date,
    userId,
    server,
    calls,
  );
}

function agent(db: Db, date: string, userId: number, type: string, runs: number): void {
  db.prepare(`INSERT INTO otel_agent_daily (date, user_id, subagent_type, invocations) VALUES (?, ?, ?, ?)`).run(
    date,
    userId,
    type,
    runs,
  );
}

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

function build(): Db {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  const ctx = { repos: { otel: new OtelRepo(db), otelPacks: new OtelPacksRepo(db) } } as unknown as AppContext;
  app = Fastify();
  registerTelemetryPackRoutes(app, ctx);
  return db;
}

async function get(qs = RANGE): Promise<PluginsResponse> {
  const res = await app!.inject({ method: 'GET', url: `/api/telemetry/plugins?${qs}` });
  expect(res.statusCode).toBe(200);
  return res.json() as PluginsResponse;
}

describe('GET /api/telemetry/plugins', () => {
  it('ranks plugins by people, with a per-skill breakdown', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    const b = addUser(db, 'b@x.com');
    // superpowers: 3 + 5 + 4 = 12 runs by 2 people across 2 skills
    meta(db, 'superpowers:brainstorming', 'superpowers');
    meta(db, 'superpowers:writing-plans', 'superpowers');
    skill(db, '2026-10-02', a, 'superpowers:brainstorming', 3, 10);
    skill(db, '2026-10-03', b, 'superpowers:brainstorming', 5, 20);
    skill(db, '2026-10-03', a, 'superpowers:writing-plans', 4, 5);
    // atlassian: one skill, 20 runs by one person — more runs, fewer people → second
    meta(db, 'atlassian:jira', 'atlassian');
    skill(db, '2026-10-04', b, 'atlassian:jira', 20, 1);
    load(db, '2026-10-02', a, 'superpowers', 7, 1);
    load(db, '2026-10-02', b, 'superpowers', 2);

    const body = await get();
    expect(body.hasData).toBe(true);
    expect(body.plugins.map((p) => p.pluginName)).toEqual(['superpowers', 'atlassian']);
    const sp = body.plugins[0]!;
    expect(sp).toMatchObject({ invocations: 12, calls: 12, users: 2, costCents: 35, loads: 9, installs: 1, loadUsers: 2 });
    expect(sp.skills).toEqual([
      { skillName: 'superpowers:brainstorming', invocations: 8, users: 2, costCents: 30 },
      { skillName: 'superpowers:writing-plans', invocations: 4, users: 1, costCents: 5 },
    ]);
  });

  it('attributes a prefix only when that prefix is a plugin Claude Code loaded', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    load(db, '2026-10-01', a, 'agentic-media-stack', 1);
    skill(db, '2026-10-02', a, 'agentic-media-stack:easy-media', 2); // no meta, known plugin → counts
    skill(db, '2026-10-02', a, 'agentic-core:git-workflow', 9); // project-folder prefix → not a plugin
    skill(db, '2026-10-02', a, 'review', 4); // no prefix at all
    meta(db, 'frontend-design', 'frontend-design'); // telemetry names the plugin, no prefix
    skill(db, '2026-10-02', a, 'frontend-design', 3);

    const body = await get();
    expect(body.plugins.map((p) => [p.pluginName, p.invocations])).toEqual([
      ['frontend-design', 3],
      ['agentic-media-stack', 2],
    ]);
  });

  it('keeps loaded-but-unused plugins after the used ones, and honors the range', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    meta(db, 'superpowers:brainstorming', 'superpowers');
    skill(db, '2026-10-02', a, 'superpowers:brainstorming', 1);
    skill(db, '2026-09-15', a, 'superpowers:brainstorming', 50); // outside range
    load(db, '2026-10-05', a, 'cc-plugin-telemetry', 40);

    const body = await get();
    expect(body.plugins.map((p) => [p.pluginName, p.invocations, p.loads])).toEqual([
      ['superpowers', 1, 0],
      ['cc-plugin-telemetry', 0, 40],
    ]);
    expect(body.plugins[1]!.skills).toEqual([]);
  });

  it('scopes to a team', async () => {
    const db = build();
    const team = Number(db.prepare(`INSERT INTO teams (name) VALUES ('Core')`).run().lastInsertRowid);
    const inTeam = addUser(db, 'in@x.com', team);
    const out = addUser(db, 'out@x.com');
    meta(db, 'superpowers:brainstorming', 'superpowers');
    skill(db, '2026-10-02', inTeam, 'superpowers:brainstorming', 2);
    skill(db, '2026-10-02', out, 'superpowers:brainstorming', 30);

    const body = await get(`${RANGE}&teamId=${team}`);
    expect(body.plugins[0]).toMatchObject({ pluginName: 'superpowers', invocations: 2, users: 1 });
  });

  it('counts MCP tool calls and agent runs toward their plugin, people across all three', async () => {
    const db = build();
    const a = addUser(db, 'a@x.com');
    const b = addUser(db, 'b@x.com');
    const c = addUser(db, 'c@x.com');
    load(db, '2026-10-01', a, 'atlassian', 1);
    load(db, '2026-10-01', a, 'agentic-media-stack', 1);
    load(db, '2026-10-01', a, 'media', 1); // 'plugin_media_kit_x' could be media's server 'kit_x' …
    load(db, '2026-10-01', a, 'media_kit', 1); // … but the longest known plugin wins
    load(db, '2026-10-01', a, 'caveman', 1);
    meta(db, 'atlassian:jira', 'atlassian');
    skill(db, '2026-10-02', a, 'atlassian:jira', 2);
    mcp(db, '2026-10-02', a, 'plugin_atlassian_bitbucket', 40); // same person as the skill run
    mcp(db, '2026-10-02', b, 'plugin_atlassian_bitbucket', 10);
    mcp(db, '2026-10-02', b, 'plugin_atlassian_atlassian', 5);
    mcp(db, '2026-10-02', c, 'plugin:atlassian:bitbucket', 0); // connection-only row → nobody used it
    mcp(db, '2026-10-02', a, 'plugin_agentic-media-stack_firecrawl', 7);
    mcp(db, '2026-10-02', a, 'plugin_media_kit_x', 2);
    mcp(db, '2026-10-02', a, 'bitbucket', 99); // a non-plugin MCP server
    agent(db, '2026-10-02', a, 'caveman:cavecrew-investigator', 3);
    agent(db, '2026-10-02', c, 'caveman:cavecrew-investigator', 1);
    agent(db, '2026-10-02', c, 'general-purpose', 50); // built-in agent, no plugin

    const body = await get();
    const at = body.plugins[0]!;
    expect(at).toMatchObject({ pluginName: 'atlassian', users: 2, calls: 57, invocations: 2, mcpCalls: 55, agentRuns: 0 });
    expect(at.mcpServers).toEqual([
      { serverName: 'plugin_atlassian_bitbucket', calls: 50, users: 2 },
      { serverName: 'plugin_atlassian_atlassian', calls: 5, users: 1 },
    ]);
    expect(body.plugins.map((p) => [p.pluginName, p.users, p.calls])).toEqual([
      ['atlassian', 2, 57],
      ['caveman', 2, 4],
      ['agentic-media-stack', 1, 7],
      ['media_kit', 1, 2],
      ['media', 0, 0],
    ]);
    expect(body.plugins[1]!.agents).toEqual([{ agentType: 'caveman:cavecrew-investigator', runs: 4, users: 2 }]);
    expect(body.users).toBe(3);
  });

  it('reports hasData:false on an empty range', async () => {
    build();
    const body = await get();
    expect(body).toMatchObject({ hasData: false, plugins: [] });
  });
});
