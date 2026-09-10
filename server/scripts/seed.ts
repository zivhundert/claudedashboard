/**
 * Deterministic demo seeder for the Claude Code org dashboard.
 *
 *   DB_PATH=/tmp/demo.db pnpm --filter @dash/server seed
 *
 * Wipes all data tables and generates ~6 months of plausible org usage:
 * 5 teams, ~30 fictional devs across personas, non-adopters, a
 * departed user, API-key actors, hourly heatmap data and score snapshots
 * (yesterday + 8 days ago) so celebrate cards and Top Movers have material.
 */
import { addDays, weekdayOf } from '@dash/shared';
import { openDb } from '../src/db/connection';
import { migrate } from '../src/db/migrate';
import { loadDotEnv, resolveFromRepoRoot } from '../src/env';
import { createRepos } from '../src/repos';
import { buildLeaderboardData } from '../src/services/scoring';
import { SNAPSHOT_RANGE_KEY } from '../src/sync/snapshot';
import { hourIsoOf, localHourOfUtc, localWeekdayOfUtc, nowIso, todayUtc } from '../src/util/time';

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32(42), fully deterministic run-to-run
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const randInt = (min: number, max: number): number => Math.floor(rand() * (max - min + 1)) + min;
const randFloat = (min: number, max: number): number => rand() * (max - min) + min;
const chance = (p: number): boolean => rand() < p;
const pick = <T>(arr: readonly T[]): T => {
  const item = arr[Math.floor(rand() * arr.length)];
  if (item === undefined) throw new Error('pick from empty array');
  return item;
};

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

const DAYS_OF_HISTORY = 180;
const HOURLY_DAYS = 30;
const EMAIL_DOMAIN = 'example.dev';

const TEAMS = [
  { name: 'Atlas', color: '#f59e0b' },
  { name: 'Nova', color: '#8b5cf6' },
  { name: 'Falcon', color: '#10b981' },
  { name: 'Orion', color: '#3b82f6' },
  { name: 'Pulse', color: '#ef4444' },
] as const;

const MODEL_RATES: Record<string, { inUsd: number; outUsd: number }> = {
  'claude-fable-5': { inUsd: 6.0, outUsd: 30.0 },
  'claude-sonnet-5': { inUsd: 3.0, outUsd: 15.0 },
  'claude-haiku-4-5-20251001': { inUsd: 0.8, outUsd: 4.0 },
};
const MODEL_NAMES = Object.keys(MODEL_RATES);

const TERMINALS = ['vscode', 'iTerm.app', 'tmux'] as const;

type PersonaKind = 'champion' | 'heavy' | 'medium' | 'light' | 'none';
type HourProfile = 'normal' | 'night' | 'early';

interface PersonaParams {
  activeP: number;
  sessions: [number, number];
  lines: [number, number];
  inputTok: [number, number];
  hourlyActivity: number;
}

const PERSONAS: Record<Exclude<PersonaKind, 'none'>, PersonaParams> = {
  champion: { activeP: 0.95, sessions: [6, 16], lines: [800, 3000], inputTok: [200_000, 800_000], hourlyActivity: 0.75 },
  heavy: { activeP: 0.8, sessions: [4, 10], lines: [400, 1500], inputTok: [100_000, 500_000], hourlyActivity: 0.6 },
  medium: { activeP: 0.5, sessions: [2, 6], lines: [150, 800], inputTok: [40_000, 250_000], hourlyActivity: 0.4 },
  light: { activeP: 0.2, sessions: [1, 3], lines: [50, 300], inputTok: [20_000, 100_000], hourlyActivity: 0.2 },
};

interface DevSpec {
  name: string;
  kind: PersonaKind;
  teamIdx: number | null;
  role: string;
  acceptance: number;
  cacheRatio: number;
  modelWeights: Record<string, number>;
  hourProfile: HourProfile;
  /** only some devs ship PRs from Claude Code — keeps the adoption-gap insight meaningful */
  createsPrs: boolean;
  departed?: boolean;
}

function modelMix(count: number, favorite: string): Record<string, number> {
  const chosen = new Set<string>([favorite]);
  while (chosen.size < count) chosen.add(pick(MODEL_NAMES));
  const weights: Record<string, number> = {};
  let total = 0;
  for (const model of chosen) {
    const w = model === favorite ? randFloat(0.5, 0.8) : randFloat(0.1, 0.4);
    weights[model] = w;
    total += w;
  }
  for (const model of chosen) weights[model] = (weights[model] ?? 0) / total;
  return weights;
}

function buildDevSpecs(): DevSpec[] {
  const names: Array<[string, PersonaKind]> = [
    ['Noa Cohen', 'champion'],
    ['Amit Levi', 'champion'],
    ['Yael Mizrahi', 'heavy'], // night owl
    ['Omer Biton', 'heavy'], // low acceptance
    ['Tamar Peretz', 'heavy'], // cache master
    ['Eitan Shapiro', 'heavy'], // early bird
    ['Lior Friedman', 'heavy'],
    ['Shira Katz', 'heavy'],
    ['Maya Golan', 'medium'], // cache leaker
    ['Idan Azulay', 'medium'],
    ['Roni Malka', 'medium'],
    ['Gal Ohana', 'medium'],
    ['Dana Avraham', 'medium'], // unassigned
    ['Yonatan Dahan', 'medium'],
    ['Michal Gabay', 'medium'],
    ['Nadav Edri', 'medium'],
    ['Hila Ben-David', 'medium'],
    ['Oren Amar', 'medium'],
    ['Talia Sharabi', 'medium'],
    ['Asaf Hadad', 'medium'],
    ['Rotem Elbaz', 'light'],
    ['Noam Sasson', 'light'], // unassigned
    ['Inbar Toledano', 'light'],
    ['Barak Aflalo', 'light'],
    ['Adi Nissim', 'light'],
    ['Shai Bouskila', 'light'],
    ['Keren Zohar', 'light'], // unassigned
    ['Erez Moyal', 'none'], // non-adopters
    ['Liat Sofer', 'none'],
    ['Yuval Baruch', 'none'],
  ];
  const unassigned = new Set([12, 21, 26]);

  const specs: DevSpec[] = names.map(([name, kind], i) => {
    const modelCount = kind === 'champion' ? 3 : kind === 'heavy' ? (chance(0.5) ? 3 : 2) : kind === 'medium' ? 2 : chance(0.5) ? 2 : 1;
    const favorite = kind === 'light' ? 'claude-haiku-4-5-20251001' : pick(['claude-fable-5', 'claude-sonnet-5']);
    return {
      name,
      kind,
      teamIdx: unassigned.has(i) ? null : i % TEAMS.length,
      role: i % 3 === 0 ? 'developer' : 'claude_code_user',
      acceptance: randFloat(0.55, 0.9),
      cacheRatio: randFloat(0.25, 0.7),
      modelWeights: modelMix(modelCount, favorite),
      hourProfile: 'normal',
      createsPrs: kind === 'champion' || chance(0.18),
    };
  });

  const at = (i: number): DevSpec => {
    const spec = specs[i];
    if (!spec) throw new Error(`missing dev spec ${i}`);
    return spec;
  };
  at(2).hourProfile = 'night'; // night owl
  at(5).hourProfile = 'early'; // early bird
  at(3).acceptance = 0.2; // struggles with acceptance
  at(4).cacheRatio = 0.85; // cache master
  at(8).cacheRatio = 0.1; // cache leaker

  // one departed user — usage only in the first half of history
  specs.push({
    name: 'Dor Kaplan',
    kind: 'medium',
    teamIdx: 1,
    role: 'claude_code_user',
    acceptance: randFloat(0.6, 0.8),
    cacheRatio: randFloat(0.3, 0.5),
    modelWeights: modelMix(2, 'claude-sonnet-5'),
    hourProfile: 'normal',
    createsPrs: false,
    departed: true,
  });
  return specs;
}

function emailOf(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z ]/g, '');
  return `${clean.split(/\s+/).join('.')}@${EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  // Only an explicit shell DB_PATH may redirect the seed. The .env DB_PATH is
  // the REAL database in every non-demo setup — loading it here once wiped a
  // live telemetry db — so read the shell value before .env is merged in.
  const explicitDbPath = process.env['DB_PATH'];
  loadDotEnv();
  process.env['DB_PATH'] = explicitDbPath ?? './data/dashboard.db';
  const dbPath = process.env['DB_PATH'] ?? './data/dashboard.db';
  const db = openDb(dbPath);
  // Safety: a database with real (non-example) people is never a demo db.
  const realUsers = (() => {
    try {
      return (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM users WHERE actor_type = 'user' AND email IS NOT NULL AND email NOT LIKE '%@example.dev'`,
          )
          .get() as { n: number }
      ).n;
    } catch {
      return 0; // no users table yet — fresh file
    }
  })();
  if (realUsers > 0 && !process.argv.includes('--force')) {
    console.error(
      `\nRefusing to seed ${resolveFromRepoRoot(dbPath)}: it holds ${realUsers} real user(s). ` +
        `Seeding RESETS the database. Point DB_PATH at a demo file, or pass --force if you really mean it.\n`,
    );
    process.exit(1);
  }
  migrate(db);
  const repos = createRepos(db, { rosterScoped: true });

  // --- wipe data tables (FK-safe order) ---
  for (const table of [
    'otel_skill_daily',
    'otel_skill_meta',
    'otel_agent_daily',
    'otel_tool_daily',
    'otel_activity_daily',
    'otel_activity_hourly',
    'otel_sessions',
    'otel_reliability_daily',
    'otel_governance_daily',
    'otel_permission_mode_daily',
    'otel_mcp_daily',
    'otel_plugin_daily',
    'otel_token_mix_daily',
    'otel_ingest_dedup',
    'score_snapshots',
    'usage_hourly',
    'usage_daily_models',
    'usage_daily',
    'usage_dimensions_daily',
    'usage_api_keys_daily',
    'cost_daily',
    'api_keys',
    'workspaces',
    'sync_runs',
    'sync_state',
    'settings',
    'teams',
    'users',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }

  const today = todayUtc();
  const historyStart = addDays(today, -(DAYS_OF_HISTORY - 1));

  // --- teams ---
  const insertTeam = db.prepare(`INSERT INTO teams (name, color) VALUES (?, ?)`);
  const teamIds: number[] = TEAMS.map((t) => Number(insertTeam.run(t.name, t.color).lastInsertRowid));

  // --- users ---
  const SEED_COUNTRIES: Array<string | null> = ['IL', 'IL', 'UA', 'IL', 'ES', 'AM', 'IL', 'US', 'GE', 'PL', 'IL', null];
  const devs = buildDevSpecs();
  const insertUser = db.prepare(
    `INSERT INTO users (actor_type, email, api_key_name, anthropic_user_id, name, role, added_at, in_roster, team_id, country)
     VALUES (@actorType, @email, @apiKeyName, @anthropicUserId, @name, @role, @addedAt, @inRoster, @teamId, @country)`,
  );

  interface SeededDev extends DevSpec {
    id: number;
    email: string;
  }
  const seededDevs: SeededDev[] = devs.map((spec, i) => {
    const addedDaysAgo = spec.departed
      ? randInt(300, 400)
      : spec.kind === 'none'
        ? randInt(35, 120)
        : randInt(60, 365);
    const addedAt = new Date(Date.parse(`${today}T09:00:00Z`) - addedDaysAgo * 86_400_000).toISOString();
    const email = emailOf(spec.name);
    const id = Number(
      insertUser.run({
        actorType: 'user',
        email,
        apiKeyName: null,
        anthropicUserId: `user_seed_${String(i).padStart(4, '0')}`,
        name: spec.name,
        role: spec.role,
        addedAt,
        inRoster: spec.departed ? 0 : 1,
        teamId: spec.teamIdx === null ? null : (teamIds[spec.teamIdx] ?? null),
        // mostly Israel, the rest spread over the other sites; a few left unknown
        country: SEED_COUNTRIES[i % SEED_COUNTRIES.length] ?? null,
      }).lastInsertRowid,
    );
    return { ...spec, id, email };
  });

  // team leads: first champion/heavy member per team
  const setLead = db.prepare(`UPDATE teams SET lead_user_id = ? WHERE id = ?`);
  for (let t = 0; t < teamIds.length; t++) {
    const lead = seededDevs.find((d) => d.teamIdx === t && (d.kind === 'champion' || d.kind === 'heavy') && !d.departed);
    if (lead) setLead.run(lead.id, teamIds[t]);
  }

  // API-key pseudo-actors
  const apiActors = [
    { name: 'ci-pipeline-key', model: 'claude-haiku-4-5-20251001' },
    { name: 'batch-eval-key', model: 'claude-sonnet-5' },
  ].map((a) => ({
    ...a,
    id: Number(
      insertUser.run({
        actorType: 'api_key',
        email: null,
        apiKeyName: a.name,
        anthropicUserId: null,
        name: a.name,
        role: null,
        addedAt: null,
        inRoster: 0,
        teamId: null,
        country: null,
      }).lastInsertRowid,
    ),
  }));

  // --- daily usage ---
  const insertDaily = db.prepare(
    `INSERT INTO usage_daily (
       date, user_id, terminal_type, customer_type, num_sessions,
       lines_added, lines_removed, commits, pull_requests,
       edit_accepted, edit_rejected, multi_edit_accepted, multi_edit_rejected,
       write_accepted, write_rejected, notebook_accepted, notebook_rejected, raw_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertModel = db.prepare(
    `INSERT INTO usage_daily_models (
       usage_daily_id, model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_cents
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const seenDates = new Map<number, { first: string; last: string }>();
  const touchSeen = (userId: number, date: string): void => {
    const cur = seenDates.get(userId);
    if (!cur) seenDates.set(userId, { first: date, last: date });
    else {
      if (date < cur.first) cur.first = date;
      if (date > cur.last) cur.last = date;
    }
  };

  const TOOL_SPLIT: Array<[string, number]> = [
    ['edit', 0.5],
    ['multi_edit', 0.2],
    ['write', 0.25],
    ['notebook', 0.05],
  ];

  let dailyRows = 0;
  let modelRows = 0;

  // Per-day accumulators fed by writeDayRows — the cost_daily seed derives
  // "actual" invoice lines from these estimates, and usage_dimensions_daily
  // splits the day's real token volume into tier/window slices.
  const dayModelCost = new Map<string, Map<string, number>>(); // date → model → est. cents
  const dayTokens = new Map<string, { input: number; output: number; cacheRead: number; cacheCreation: number }>();

  interface DayMetrics {
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    prs: number;
    tools: Record<string, { accepted: number; rejected: number }>;
    models: Array<{ model: string; input: number; output: number; cacheRead: number; cacheCreation: number; costCents: number }>;
  }

  const writeDayRows = (
    userId: number,
    date: string,
    customerType: string,
    terminals: string[],
    metrics: DayMetrics,
  ): void => {
    const fractions =
      terminals.length === 2 ? [0.65, 0.35] : [1.0];
    for (let i = 0; i < fractions.length; i++) {
      const f = fractions[i] ?? 1;
      const term = terminals[i] ?? '';
      const t = (key: string): { accepted: number; rejected: number } =>
        metrics.tools[key] ?? { accepted: 0, rejected: 0 };
      const scale = (v: number): number => Math.round(v * f);
      const res = insertDaily.run(
        date,
        userId,
        term,
        customerType,
        Math.max(1, scale(metrics.sessions)),
        scale(metrics.linesAdded),
        scale(metrics.linesRemoved),
        scale(metrics.commits),
        scale(metrics.prs),
        scale(t('edit').accepted),
        scale(t('edit').rejected),
        scale(t('multi_edit').accepted),
        scale(t('multi_edit').rejected),
        scale(t('write').accepted),
        scale(t('write').rejected),
        scale(t('notebook').accepted),
        scale(t('notebook').rejected),
        JSON.stringify({ seeded: true, date, terminal: term }),
      );
      const dailyId = Number(res.lastInsertRowid);
      dailyRows += 1;
      for (const m of metrics.models) {
        insertModel.run(
          dailyId,
          m.model,
          scale(m.input),
          scale(m.output),
          scale(m.cacheRead),
          scale(m.cacheCreation),
          m.costCents * f,
        );
        modelRows += 1;

        let costs = dayModelCost.get(date);
        if (!costs) {
          costs = new Map();
          dayModelCost.set(date, costs);
        }
        costs.set(m.model, (costs.get(m.model) ?? 0) + m.costCents * f);
        let tokens = dayTokens.get(date);
        if (!tokens) {
          tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
          dayTokens.set(date, tokens);
        }
        tokens.input += scale(m.input);
        tokens.output += scale(m.output);
        tokens.cacheRead += scale(m.cacheRead);
        tokens.cacheCreation += scale(m.cacheCreation);
      }
    }
    touchSeen(userId, date);
  };

  const seedAll = db.transaction(() => {
    for (const dev of seededDevs) {
      if (dev.kind === 'none') continue; // non-adopters: zero usage
      const persona = PERSONAS[dev.kind];
      const userTerminals: string[] = [pick(TERMINALS)];
      if (chance(0.45)) {
        const second = pick(TERMINALS);
        if (second !== userTerminals[0]) userTerminals.push(second);
      }

      for (let d = 0; d < DAYS_OF_HISTORY; d++) {
        const date = addDays(historyStart, d);
        if (dev.departed && date >= addDays(today, -90)) continue; // left mid-history
        const wd = weekdayOf(date);
        const weekend = wd === 5 || wd === 6; // Fri/Sat
        const activeP = weekend ? 0.05 : persona.activeP;
        if (!chance(activeP)) continue;

        const sessions = randInt(persona.sessions[0], persona.sessions[1]);
        const linesAdded = randInt(persona.lines[0], persona.lines[1]);
        const linesRemoved = Math.round(linesAdded * randFloat(0.2, 0.4));
        const commits = Math.max(0, Math.round((linesAdded / 400) * randFloat(0.6, 1.4)));
        const prs = dev.createsPrs && commits > 0 ? Math.round((commits / 6) * randFloat(0.5, 1.6)) : 0;

        const toolEvents = Math.round(linesAdded / 25);
        const tools: DayMetrics['tools'] = {};
        for (const [tool, weight] of TOOL_SPLIT) {
          const events = Math.round(toolEvents * weight);
          const rate = Math.min(1, Math.max(0, dev.acceptance * randFloat(0.9, 1.1)));
          const accepted = Math.round(events * rate);
          tools[tool] = { accepted, rejected: events - accepted };
        }

        const totalInput = randInt(persona.inputTok[0], persona.inputTok[1]);
        const models: DayMetrics['models'] = [];
        for (const [model, weight] of Object.entries(dev.modelWeights)) {
          const input = Math.round(totalInput * weight * randFloat(0.8, 1.2));
          if (input <= 0) continue;
          const output = Math.round(input / 4);
          const ratio = Math.min(0.9, Math.max(0.05, dev.cacheRatio + randFloat(-0.05, 0.05)));
          const cacheRead = Math.round((ratio * input) / (1 - ratio));
          const cacheCreation = Math.round(input / 10);
          const rates = MODEL_RATES[model] ?? { inUsd: 3.0, outUsd: 15.0 };
          const costUsd =
            (input / 1e6) * rates.inUsd +
            (output / 1e6) * rates.outUsd +
            (cacheRead / 1e6) * rates.inUsd * 0.1;
          models.push({ model, input, output, cacheRead, cacheCreation, costCents: costUsd * 100 });
        }

        const useBoth = userTerminals.length === 2 && chance(0.35);
        writeDayRows(dev.id, date, 'subscription', useBoth ? userTerminals : userTerminals.slice(0, 1), {
          sessions,
          linesAdded,
          linesRemoved,
          commits,
          prs,
          tools,
          models,
        });
      }
    }

    // API-key actors: modest weekday automation traffic
    for (const actor of apiActors) {
      for (let d = 0; d < DAYS_OF_HISTORY; d++) {
        const date = addDays(historyStart, d);
        const wd = weekdayOf(date);
        if (wd === 5 || wd === 6) continue;
        if (!chance(0.6)) continue;
        const input = randInt(10_000, 80_000);
        const output = Math.round(input / 5);
        const rates = MODEL_RATES[actor.model] ?? { inUsd: 3.0, outUsd: 15.0 };
        const costUsd = (input / 1e6) * rates.inUsd + (output / 1e6) * rates.outUsd;
        writeDayRows(actor.id, date, 'api', [''], {
          sessions: randInt(1, 4),
          linesAdded: randInt(0, 120),
          linesRemoved: randInt(0, 40),
          commits: 0,
          prs: 0,
          tools: {},
          models: [
            { model: actor.model, input, output, cacheRead: Math.round(input * 0.1), cacheCreation: Math.round(input / 20), costCents: costUsd * 100 },
          ],
        });
      }
    }
  });
  seedAll();

  // first/last seen
  const setSeen = db.prepare(`UPDATE users SET first_seen_date = ?, last_seen_date = ? WHERE id = ?`);
  for (const [userId, seen] of seenDates) setSeen.run(seen.first, seen.last, userId);

  // --- hourly usage (30 days, ~20 OAuth users) ---
  const insertHourly = db.prepare(
    `INSERT INTO usage_hourly (user_id, hour_utc, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, web_search_requests)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, hour_utc) DO UPDATE SET
       uncached_input_tokens = excluded.uncached_input_tokens,
       cache_creation_tokens = excluded.cache_creation_tokens,
       cache_read_tokens = excluded.cache_read_tokens,
       output_tokens = excluded.output_tokens,
       web_search_requests = excluded.web_search_requests`,
  );

  const hourWeight = (profile: HourProfile, ilHour: number, ilWeekday: number): number => {
    const weekend = ilWeekday === 5 || ilWeekday === 6;
    if (profile === 'night') {
      const w = ilHour >= 22 || ilHour < 2 ? 1.0 : ilHour >= 19 ? 0.35 : ilHour >= 10 && ilHour < 17 ? 0.15 : 0.05;
      return weekend ? w * 0.5 : w;
    }
    if (profile === 'early') {
      const w = ilHour >= 6 && ilHour < 9 ? 1.0 : ilHour >= 9 && ilHour < 13 ? 0.45 : ilHour >= 13 && ilHour < 18 ? 0.2 : 0.02;
      return weekend ? w * 0.1 : w;
    }
    const w = ilHour >= 9 && ilHour < 19 ? 1.0 : ilHour === 8 || ilHour === 19 || ilHour === 20 ? 0.35 : 0.03;
    return weekend ? w * 0.05 : w;
  };

  const oauthUsers = seededDevs.filter((d) => d.kind !== 'none' && !d.departed).slice(0, 20);
  // ~15% of hourly rows carry web searches, for 8 users; the first is a
  // clear top searcher (higher hit rate AND bigger bursts).
  const webSearchUserIds = new Set(oauthUsers.slice(0, 8).map((d) => d.id));
  const topWebSearchUserId = oauthUsers[0]?.id ?? -1;
  let webSearchTotal = 0;
  const nowHourMs = Date.parse(hourIsoOf(new Date()));
  let hourlyRows = 0;
  const seedHourly = db.transaction(() => {
    for (const dev of oauthUsers) {
      const persona = PERSONAS[dev.kind as Exclude<PersonaKind, 'none'>];
      for (let hb = 0; hb < HOURLY_DAYS * 24; hb++) {
        const iso = hourIsoOf(new Date(nowHourMs - hb * 3_600_000));
        const ilHour = localHourOfUtc(iso);
        const ilWd = localWeekdayOfUtc(iso);
        const weight = hourWeight(dev.hourProfile, ilHour, ilWd);
        if (!chance(weight * persona.hourlyActivity)) continue;
        const total = Math.round(randInt(20_000, 150_000) * weight);
        if (total <= 0) continue;
        const r = dev.cacheRatio;
        let webSearches = 0;
        if (webSearchUserIds.has(dev.id)) {
          const isTop = dev.id === topWebSearchUserId;
          if (chance(isTop ? 0.35 : 0.15)) webSearches = randInt(1, isTop ? 12 : 4);
        }
        webSearchTotal += webSearches;
        insertHourly.run(
          dev.id,
          iso,
          Math.round(total * (1 - r) * 0.7),
          Math.round(total * (1 - r) * 0.1),
          Math.round(total * r),
          Math.round(total * (1 - r) * 0.2),
          webSearches,
        );
        hourlyRows += 1;
      }
    }
  });
  seedHourly();

  // --- workspaces (the third "workspace" is the default one: cost rows carry
  //     workspace_id '' — API null — and routes render 'Default workspace') ---
  const WORKSPACES = [
    { id: 'wrkspc_seed_prod', name: 'Production', color: '#10b981' },
    { id: 'wrkspc_seed_research', name: 'Research', color: '#8b5cf6' },
  ] as const;
  const insertWorkspace = db.prepare(
    `INSERT INTO workspaces (id, name, display_color, archived_at) VALUES (?, ?, ?, ?)`,
  );
  for (const ws of WORKSPACES) insertWorkspace.run(ws.id, ws.name, ws.color, null);

  // --- api key inventory: 2 named exactly like the api_actor pseudo-users ---
  const creatorA = 'user_seed_0000'; // Noa Cohen
  const creatorB = 'user_seed_0001'; // Amit Levi
  type KeyUsageProfile = 'heavy' | 'steady' | 'light' | 'none';
  const keySpecs: Array<{
    id: string;
    name: string;
    status: string;
    createdBy: string;
    workspaceId: string | null;
    usage: KeyUsageProfile;
  }> = [
    { id: 'apikey_seed_ci', name: 'ci-pipeline-key', status: 'active', createdBy: creatorA, workspaceId: 'wrkspc_seed_prod', usage: 'heavy' },
    { id: 'apikey_seed_batch', name: 'batch-eval-key', status: 'active', createdBy: creatorB, workspaceId: null, usage: 'steady' },
    { id: 'apikey_seed_staging', name: 'staging-smoke-key', status: 'active', createdBy: creatorA, workspaceId: 'wrkspc_seed_prod', usage: 'light' },
    { id: 'apikey_seed_research', name: 'research-notebook-key', status: 'inactive', createdBy: creatorB, workspaceId: 'wrkspc_seed_research', usage: 'light' },
    { id: 'apikey_seed_legacy', name: 'legacy-integration-key', status: 'archived', createdBy: creatorA, workspaceId: null, usage: 'none' },
    { id: 'apikey_seed_hackathon', name: 'hackathon-demo-key', status: 'inactive', createdBy: creatorB, workspaceId: null, usage: 'none' },
  ];
  const insertApiKey = db.prepare(
    `INSERT INTO api_keys (id, name, status, partial_key_hint, created_at, created_by_user_id, workspace_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const spec of keySpecs) {
    const createdAt = new Date(Date.parse(`${today}T09:00:00Z`) - randInt(120, 400) * 86_400_000).toISOString();
    insertApiKey.run(
      spec.id,
      spec.name,
      spec.status,
      `sk-ant-...${spec.id.slice(-4)}`,
      createdAt,
      spec.createdBy,
      spec.workspaceId,
    );
  }

  // --- per-key daily usage: 90 days for 4 keys, CI clearly heaviest ---
  const KEY_USAGE_DAYS = 90;
  const KEY_USAGE_RANGES: Record<Exclude<KeyUsageProfile, 'none'>, { p: number; input: [number, number] }> = {
    heavy: { p: 0.95, input: [800_000, 3_000_000] },
    steady: { p: 0.7, input: [150_000, 600_000] },
    light: { p: 0.3, input: [10_000, 120_000] },
  };
  const insertKeyUsage = db.prepare(
    `INSERT INTO usage_api_keys_daily (date, api_key_id, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  let keyUsageRows = 0;
  const seedKeyUsage = db.transaction(() => {
    for (const spec of keySpecs) {
      if (spec.usage === 'none') continue;
      const profile = KEY_USAGE_RANGES[spec.usage];
      for (let d = 0; d < KEY_USAGE_DAYS; d++) {
        const date = addDays(today, -d);
        const wd = weekdayOf(date);
        const weekend = wd === 5 || wd === 6;
        if (!chance(weekend ? profile.p * 0.15 : profile.p)) continue;
        const input = randInt(profile.input[0], profile.input[1]);
        insertKeyUsage.run(
          date,
          spec.id,
          input,
          Math.round(input * 0.05),
          Math.round(input * 0.25),
          Math.round(input / 5),
        );
        keyUsageRows += 1;
      }
    }
  });
  seedKeyUsage();

  // --- cost_daily: actual ≈ estimated × 1.02..1.15 per model per day, split
  //     by token_type; occasional web_search/code_execution line items; a few
  //     rows attributed to the two non-default workspaces ---
  const TOKEN_TYPE_SPLIT: Array<[string, number]> = [
    ['uncached_input_tokens', 0.45],
    ['output_tokens', 0.35],
    ['cache_read_input_tokens', 0.15],
    ['cache_creation.ephemeral_5m_input_tokens', 0.05],
  ];
  const insertCost = db.prepare(
    `INSERT INTO cost_daily (date, workspace_id, cost_type, token_type, model, service_tier, context_window, description, amount_cents, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let costRows = 0;
  const seedCosts = db.transaction(() => {
    for (let d = 0; d < DAYS_OF_HISTORY; d++) {
      const date = addDays(historyStart, d);
      const models = dayModelCost.get(date);
      if (!models) continue;
      let dayEstCents = 0;
      for (const [model, estCents] of models) {
        dayEstCents += estCents;
        const factor = randFloat(1.02, 1.15);
        const workspaceId = chance(0.12) ? pick(WORKSPACES).id : '';
        for (const [tokenType, share] of TOKEN_TYPE_SPLIT) {
          insertCost.run(
            date,
            workspaceId,
            'tokens',
            tokenType,
            model,
            'standard',
            '0-200k',
            `${model} tokens`,
            estCents * factor * share,
            'USD',
          );
          costRows += 1;
        }
      }
      // small non-token line items, proportional to the day's spend so tiny
      // (weekend) days keep actual within ~2-15% above estimated
      if (chance(0.3)) {
        insertCost.run(date, '', 'web_search', '', '', '', '', 'Web search usage', dayEstCents * randFloat(0.003, 0.012), 'USD');
        costRows += 1;
      }
      if (chance(0.3)) {
        insertCost.run(date, '', 'code_execution', '', '', '', '', 'Code execution usage', dayEstCents * randFloat(0.002, 0.008), 'USD');
        costRows += 1;
      }
    }
  });
  seedCosts();

  // --- usage_dimensions_daily: 90 days of tier/window slices of the day's
  //     real token volume (≈85% standard/0-200k, ≈10% batch, ≈5% 200k-1M) ---
  const DIMENSION_DAYS = 90;
  const DIMENSION_SPLIT: Array<[string, string, number]> = [
    ['standard', '0-200k', 0.85],
    ['batch', '0-200k', 0.1],
    ['standard', '200k-1M', 0.05],
  ];
  const insertDimension = db.prepare(
    `INSERT INTO usage_dimensions_daily (date, service_tier, context_window, uncached_input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let dimensionRows = 0;
  const seedDimensions = db.transaction(() => {
    for (let d = 0; d < DIMENSION_DAYS; d++) {
      const date = addDays(today, -d);
      const tokens = dayTokens.get(date);
      if (!tokens) continue;
      for (const [tier, window, share] of DIMENSION_SPLIT) {
        insertDimension.run(
          date,
          tier,
          window,
          Math.round(tokens.input * share),
          Math.round(tokens.cacheCreation * share),
          Math.round(tokens.cacheRead * share),
          Math.round(tokens.output * share),
        );
        dimensionRows += 1;
      }
    }
  });
  seedDimensions();

  // --- OTel skills / agents / tools: 90 days of daily aggregates written
  //     directly into otel_*_daily for ~18 active users. Adoption story:
  //     champions run 4-5 skills, mediums 1-2, several active users none. ---
  const OTEL_DAYS = 90;
  const SKILL_CATALOG = ['code-review', 'verify', 'commit', 'deep-research', 'graphify', 'fix-tests', 'custom_skill'];
  const AGENT_CATALOG = ['Explore', 'Plan', 'general-purpose', 'code-reviewer'];
  const FLAKY_AGENT = 'code-reviewer'; // ~0.6 success; everything else ~0.9
  const OTEL_TOOLS: Array<[string, number]> = [
    ['Read', 0.28],
    ['Bash', 0.24],
    ['Edit', 0.13],
    ['Grep', 0.11],
    ['Write', 0.06],
    ['Glob', 0.06],
    ['TodoWrite', 0.05],
    ['WebFetch', 0.03],
    ['ExitPlanMode', 0.012],
    ['mcp__jira__search', 0.025],
    ['mcp__slack__send', 0.015],
  ];
  const DECISION_TOOLS = new Set(['Edit', 'Write', 'ExitPlanMode']);

  const insertOtelSkill = db.prepare(
    `INSERT INTO otel_skill_daily (date, user_id, skill_name, invocations, user_slash, proactive, nested, cost_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // What each seeded skill IS (mirrors otel_skill_meta learned from skill_activated attrs)
  const SKILL_META: Record<string, [source: string, kind: string, plugin: string | null, marketplace: string | null]> = {
    'code-review': ['plugin', 'skill', 'fde', 'thetaray-plugins'],
    verify: ['project', 'skill', null, null],
    commit: ['bundled', 'skill', null, null],
    'deep-research': ['plugin', 'skill', 'anthropic-skills', 'claude-plugins-official'],
    graphify: ['user', 'skill', null, null],
    'fix-tests': ['project', 'skill', null, null],
  };
  const insertSkillMeta = db.prepare(
    `INSERT OR REPLACE INTO otel_skill_meta (skill_name, source, kind, plugin_name, marketplace_name, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [name, [source, kind, plugin, marketplace]] of Object.entries(SKILL_META)) {
    insertSkillMeta.run(name, source, kind, plugin, marketplace, `${addDays(today, -OTEL_DAYS)}T09:00:00.000Z`, `${today}T09:00:00.000Z`);
  }

  const insertOtelAgent = db.prepare(
    `INSERT INTO otel_agent_daily (date, user_id, subagent_type, invocations, success, failure, cost_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertOtelTool = db.prepare(
    `INSERT INTO otel_tool_daily (date, user_id, tool_name, uses, success, failure, accepted, rejected)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const otelUsers = seededDevs.filter((d) => d.kind !== 'none' && !d.departed).slice(0, 18);
  interface OtelProfile {
    dev: (typeof otelUsers)[number];
    skills: string[]; // empty = active user who hasn't adopted skills
    skillBurst: [number, number];
    agentBurst: [number, number];
    toolVolume: [number, number];
  }
  const otelProfiles: OtelProfile[] = otelUsers.map((dev) => {
    // per-persona skill affinity — deterministic via the seeded PRNG
    let skillCount: number;
    if (dev.kind === 'champion') skillCount = randInt(4, 5);
    else if (dev.kind === 'heavy') skillCount = chance(0.25) ? 0 : randInt(2, 4); // a couple of heavy holdouts
    else if (dev.kind === 'medium') skillCount = chance(0.35) ? 0 : randInt(1, 2); // several mediums at zero
    else skillCount = chance(0.6) ? 0 : 1;
    const skills = new Set<string>();
    while (skills.size < skillCount) skills.add(pick(SKILL_CATALOG));
    const burst: Record<PersonaKind, { skill: [number, number]; agent: [number, number]; tools: [number, number] }> = {
      champion: { skill: [1, 5], agent: [2, 9], tools: [150, 450] },
      heavy: { skill: [1, 4], agent: [1, 6], tools: [90, 280] },
      medium: { skill: [1, 2], agent: [0, 3], tools: [30, 130] },
      light: { skill: [1, 1], agent: [0, 1], tools: [10, 50] },
      none: { skill: [0, 0], agent: [0, 0], tools: [0, 0] },
    };
    const b = burst[dev.kind];
    return { dev, skills: [...skills], skillBurst: b.skill, agentBurst: b.agent, toolVolume: b.tools };
  });

  let otelSkillInvocations = 0;
  let otelAgentInvocations = 0;
  let otelToolUses = 0;
  let otelDecisions = 0;
  const otelStart = addDays(today, -(OTEL_DAYS - 1));
  const seedOtel = db.transaction(() => {
    for (const profile of otelProfiles) {
      const { dev } = profile;
      const persona = PERSONAS[dev.kind as Exclude<PersonaKind, 'none'>];
      for (let d = 0; d < OTEL_DAYS; d++) {
        const date = addDays(otelStart, d);
        const wd = weekdayOf(date);
        const weekend = wd === 5 || wd === 6;
        if (!chance(weekend ? persona.activeP * 0.06 : persona.activeP)) continue;

        // --- skills: trigger mix ~55% user-slash / 35% proactive / 10% nested,
        //     cost proportional-ish to invocations ---
        for (const skill of profile.skills) {
          if (!chance(0.55)) continue;
          const invocations = randInt(profile.skillBurst[0], profile.skillBurst[1]);
          let userSlash = 0;
          let proactive = 0;
          let nested = 0;
          for (let i = 0; i < invocations; i++) {
            const r = rand();
            if (r < 0.55) userSlash += 1;
            else if (r < 0.9) proactive += 1;
            else nested += 1;
          }
          const costCents = invocations * randFloat(15, 110);
          insertOtelSkill.run(date, dev.id, skill, invocations, userSlash, proactive, nested, costCents);
          otelSkillInvocations += invocations;
        }

        // --- agents: success ~0.9, one flaky type ~0.6 ---
        const agentTotal = randInt(profile.agentBurst[0], profile.agentBurst[1]);
        if (agentTotal > 0) {
          const perAgent = new Map<string, number>();
          for (let i = 0; i < agentTotal; i++) {
            const agent = pick(AGENT_CATALOG);
            perAgent.set(agent, (perAgent.get(agent) ?? 0) + 1);
          }
          for (const [agent, invocations] of perAgent) {
            const successP = agent === FLAKY_AGENT ? 0.6 : 0.9;
            let success = 0;
            for (let i = 0; i < invocations; i++) if (chance(successP)) success += 1;
            const costCents = invocations * randFloat(40, 220);
            insertOtelAgent.run(date, dev.id, agent, invocations, success, invocations - success, costCents);
            otelAgentInvocations += invocations;
          }
        }

        // --- tools: Read/Bash dominate; accepted/rejected only on Edit/Write ---
        const toolTotal = randInt(profile.toolVolume[0], profile.toolVolume[1]);
        for (const [tool, weight] of OTEL_TOOLS) {
          const uses = Math.round(toolTotal * weight * randFloat(0.7, 1.3));
          if (uses <= 0) continue;
          const success = Math.min(uses, Math.round(uses * randFloat(0.92, 0.995)));
          let accepted = 0;
          let rejected = 0;
          if (DECISION_TOOLS.has(tool)) {
            const decisions = Math.round(uses * randFloat(0.6, 0.95));
            accepted = Math.round(decisions * Math.min(1, dev.acceptance * randFloat(0.95, 1.05)));
            rejected = Math.max(0, decisions - accepted);
            otelDecisions += accepted + rejected;
          }
          insertOtelTool.run(date, dev.id, tool, uses, success, uses - success, accepted, rejected);
          otelToolUses += uses;
        }
      }
    }
  });
  seedOtel();

  // --- Telemetry packs (migration 006): activity, sessions, reliability,
  //     governance, MCP/plugin ecosystem and token mix for the same ~18 otel
  //     users over 90 days — mirroring each persona's intensity. ---
  const insertPackActivity = db.prepare(
    `INSERT INTO otel_activity_daily (date, user_id, active_user_s, active_cli_s, prompts, sessions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertPackHourly = db.prepare(
    `INSERT INTO otel_activity_hourly (hour_utc, user_id, prompts, api_requests, sessions_started)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertPackSession = db.prepare(
    `INSERT INTO otel_sessions (session_id, user_id, date, first_event_at, last_event_at, events, prompts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPackReliability = db.prepare(
    `INSERT INTO otel_reliability_daily (
       date, user_id, model, api_requests, api_errors, errors_429, errors_5xx, errors_other,
       refusals, compactions, internal_errors, total_duration_ms
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPackGovernance = db.prepare(
    `INSERT INTO otel_governance_daily (
       date, user_id, src_config, src_hook, src_user_permanent, src_user_temporary,
       src_user_abort, src_user_reject, permission_mode_changes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPackPermMode = db.prepare(
    `INSERT INTO otel_permission_mode_daily (date, user_id, mode, changes) VALUES (?, ?, ?, ?)`,
  );
  const insertPackMcp = db.prepare(
    `INSERT INTO otel_mcp_daily (
       date, user_id, server_name, tool_calls, tool_failures, tokens, cost_cents, connections, connection_failures
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertPackPlugin = db.prepare(
    `INSERT INTO otel_plugin_daily (date, user_id, plugin_name, installs, loads) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertPackTokenMix = db.prepare(
    `INSERT INTO otel_token_mix_daily (date, user_id, model, speed, effort, tokens, cost_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  // story beats
  const FLAKY_API_MODEL = 'claude-haiku-4-5-20251001'; // ~6% error rate wherever used
  const rateLimitedDev = otelProfiles[3]?.dev ?? null; // one 429-heavy week
  const heavy429From = addDays(today, -9);
  const heavy429To = addDays(today, -3);
  const bypassDev = otelProfiles[6]?.dev ?? null; // keeps flipping into bypassPermissions
  const MCP_SERVERS: Array<[string, number]> = [
    ['jira', 0.5],
    ['github', 0.55],
    ['slack', 0.3],
    ['internal-docs', 0.22],
  ];
  const PLUGIN_CATALOG = ['dataviz', 'security-scanner', 'release-notes'];
  const PACK_SCALE: Record<Exclude<PersonaKind, 'none'>, number> = {
    champion: 1,
    heavy: 0.8,
    medium: 0.5,
    light: 0.25,
  };

  let packActivityRows = 0;
  let packHourlyRows = 0;
  let packSessionRows = 0;
  let packReliabilityRows = 0;
  let packGovernanceRows = 0;
  let packMcpRows = 0;
  let packPluginRows = 0;
  let packTokenMixRows = 0;
  const sessionWindowStart = addDays(today, -13); // otel_sessions: ~last 14 days
  const installedPlugins = new Set<string>(); // `${userId}:${plugin}` → installs only once

  const seedPacks = db.transaction(() => {
    for (const profile of otelProfiles) {
      const { dev } = profile;
      const persona = PERSONAS[dev.kind as Exclude<PersonaKind, 'none'>];
      const scale = PACK_SCALE[dev.kind as Exclude<PersonaKind, 'none'>];
      const devPlugins = PLUGIN_CATALOG.filter(() => chance(dev.kind === 'champion' ? 0.8 : 0.35));

      for (let d = 0; d < OTEL_DAYS; d++) {
        const date = addDays(otelStart, d);
        const wd = weekdayOf(date);
        const weekend = wd === 5 || wd === 6;
        if (!chance(weekend ? persona.activeP * 0.06 : persona.activeP)) continue;

        // activity: 1-5h of user-active time on workdays, CLI ~2-3x that
        const activeUserS = Math.round(randFloat(1, 5) * 3600 * scale);
        const activeCliS = Math.round(activeUserS * randFloat(2, 3));
        const prompts = Math.max(5, Math.round(randInt(10, 80) * scale));
        const sessions = randInt(persona.sessions[0], persona.sessions[1]);
        insertPackActivity.run(date, dev.id, activeUserS, activeCliS, prompts, sessions);
        packActivityRows += 1;

        // reliability per model: baseline 0.5-2% errors, FLAKY_API_MODEL ~6%,
        // one user's 429 storm for a week, few refusals, avg request 8-20s
        for (const model of Object.keys(dev.modelWeights)) {
          const weight = dev.modelWeights[model] ?? 0.3;
          const requests = Math.max(5, Math.round(prompts * randFloat(2, 5) * weight));
          const errP = model === FLAKY_API_MODEL ? randFloat(0.045, 0.075) : randFloat(0.005, 0.02);
          const baseErrors = Math.round(requests * errP);
          const e5xx = Math.round(baseErrors * randFloat(0.3, 0.5));
          const eOther = baseErrors - e5xx;
          const e429 =
            rateLimitedDev !== null && dev.id === rateLimitedDev.id && date >= heavy429From && date <= heavy429To
              ? randInt(8, 25)
              : chance(0.04)
                ? randInt(1, 2)
                : 0;
          const refusals = chance(0.04) ? randInt(1, 2) : 0;
          const totalDurationMs = requests * randInt(8_000, 20_000);
          insertPackReliability.run(
            date, dev.id, model, requests, e429 + e5xx + eOther, e429, e5xx, eOther,
            refusals, 0, 0, totalDurationMs,
          );
          packReliabilityRows += 1;

          // token mix: same models split across speed/effort lanes
          const rates = MODEL_RATES[model] ?? { inUsd: 3.0, outUsd: 15.0 };
          const speed = chance(0.8) ? 'standard' : 'fast';
          const effort = chance(0.7) ? 'medium' : 'high';
          const tokens = Math.max(1_000, Math.round(randInt(persona.inputTok[0], persona.inputTok[1]) * weight * 0.2));
          const costCents = (tokens / 1e6) * rates.inUsd * 100 * (effort === 'high' ? 1.4 : 1);
          insertPackTokenMix.run(date, dev.id, model, speed, effort, tokens, costCents);
          packTokenMixRows += 1;
        }
        // model='' bookkeeping row: compactions cluster on heavy users
        const compactions =
          dev.kind === 'champion' || dev.kind === 'heavy' ? randInt(1, 6) : chance(0.15) ? 1 : 0;
        const internalErrors = chance(0.04) ? 1 : 0;
        if (compactions > 0 || internalErrors > 0) {
          insertPackReliability.run(date, dev.id, '', 0, 0, 0, 0, 0, 0, compactions, internalErrors, 0);
          packReliabilityRows += 1;
        }

        // governance: mostly config + user_permanent, healthy reject/abort sprinkle
        const decisions = Math.max(4, Math.round(prompts * randFloat(0.5, 1.5)));
        const srcConfig = Math.round(decisions * randFloat(0.4, 0.5));
        const srcPermanent = Math.round(decisions * randFloat(0.2, 0.3));
        const srcHook = Math.round(decisions * randFloat(0.05, 0.12));
        const srcTemporary = Math.round(decisions * randFloat(0.06, 0.14));
        const srcReject = chance(0.7) ? randInt(1, Math.max(1, Math.round(decisions * 0.08))) : 0;
        const srcAbort = chance(0.5) ? randInt(1, Math.max(1, Math.round(decisions * 0.05))) : 0;
        const isBypassUser = bypassDev !== null && dev.id === bypassDev.id;
        const modeChanges = isBypassUser ? (chance(0.6) ? randInt(1, 4) : 0) : chance(0.22) ? randInt(1, 3) : 0;
        insertPackGovernance.run(
          date, dev.id, srcConfig, srcHook, srcPermanent, srcTemporary, srcAbort, srcReject, modeChanges,
        );
        packGovernanceRows += 1;
        if (modeChanges > 0) {
          const perMode = new Map<string, number>();
          for (let i = 0; i < modeChanges; i++) {
            const mode = isBypassUser && chance(0.75) ? 'bypassPermissions' : pick(['default', 'acceptEdits', 'plan']);
            perMode.set(mode, (perMode.get(mode) ?? 0) + 1);
          }
          for (const [mode, changes] of perMode) insertPackPermMode.run(date, dev.id, mode, changes);
        }

        // MCP ecosystem: jira/github/slack/internal-docs
        for (const [server, p] of MCP_SERVERS) {
          if (!chance(p * (scale + 0.3))) continue;
          const toolCalls = Math.max(1, Math.round(randInt(3, 40) * scale));
          const toolFailures = Math.round(toolCalls * randFloat(0.02, 0.08));
          const tokens = randInt(3_000, 60_000);
          const costCents = randFloat(2, 60) * scale;
          const connections = randInt(1, 3);
          const connectionFailures = chance(0.06) ? 1 : 0;
          insertPackMcp.run(
            date, dev.id, server, toolCalls, toolFailures, tokens, costCents, connections, connectionFailures,
          );
          packMcpRows += 1;
        }

        // plugins: install once, then loads on active days
        for (const plugin of devPlugins) {
          if (!chance(0.45)) continue;
          const key = `${dev.id}:${plugin}`;
          const installs = installedPlugins.has(key) ? 0 : 1;
          installedPlugins.add(key);
          insertPackPlugin.run(date, dev.id, plugin, installs, randInt(1, 6));
          packPluginRows += 1;
        }

        // sessions: only the trailing ~14 days are retained
        if (date >= sessionWindowStart) {
          const sessionCount = Math.min(sessions, randInt(1, 4));
          for (let s = 0; s < sessionCount; s++) {
            const startHour = dev.hourProfile === 'night' ? randInt(18, 22) : dev.hourProfile === 'early' ? randInt(3, 7) : randInt(6, 16);
            const startMs = Date.parse(`${date}T00:00:00Z`) + startHour * 3_600_000 + randInt(0, 59) * 60_000;
            const durationMs = randInt(10, 120) * 60_000; // 10-120 minutes
            const sessionPrompts = randInt(3, 30);
            insertPackSession.run(
              `seed-${dev.id}-${date}-${s}`,
              dev.id,
              date,
              new Date(startMs).toISOString(),
              new Date(startMs + durationMs).toISOString(),
              sessionPrompts * randInt(3, 8),
              sessionPrompts,
            );
            packSessionRows += 1;
          }
        }
      }

      // hourly activity: last 48h shaped by the dev's IL-hour profile so the
      // LiveToday strip has material
      for (let hb = 0; hb < 48; hb++) {
        const iso = hourIsoOf(new Date(nowHourMs - hb * 3_600_000));
        const weight = hourWeight(dev.hourProfile, localHourOfUtc(iso), localWeekdayOfUtc(iso));
        if (!chance(weight * persona.hourlyActivity)) continue;
        const hourPrompts = Math.max(1, Math.round(randInt(2, 14) * weight));
        insertPackHourly.run(iso, dev.id, hourPrompts, hourPrompts * randInt(2, 6), chance(0.4) ? 1 : 0);
        packHourlyRows += 1;
      }
    }

    // Claude Code version drift: 3 versions in the wild, most on the latest
    const APP_VERSIONS = ['2.1.9', '2.1.3', '2.0.14'] as const;
    const setAppVersion = db.prepare(`UPDATE users SET cc_app_version = ?, cc_app_version_as_of = ? WHERE id = ?`);
    for (const profile of otelProfiles) {
      const r = rand();
      const version = r < 0.65 ? APP_VERSIONS[0] : r < 0.9 ? APP_VERSIONS[1] : APP_VERSIONS[2];
      setAppVersion.run(version, `${addDays(today, -randInt(0, 5))}T08:00:00.000Z`, profile.dev.id);
    }
  });
  seedPacks();

  // --- settings + sync state/runs ---
  repos.settings.ensureDefaults();
  repos.sync.setState('backfill_done', '1');
  repos.sync.setState('backfill_cursor', addDays(historyStart, -1));
  repos.sync.setState('backfill_earliest_date', historyStart);
  repos.sync.setState('daily_watermark', today);
  repos.sync.setState('hourly_watermark', hourIsoOf(new Date()));
  repos.sync.setState('roster_synced_at', nowIso());
  // OTel receiver counters — every seeded aggregate counts as one ingested event
  repos.sync.setState(
    'otel_events_ingested',
    String(otelSkillInvocations + otelAgentInvocations + otelToolUses + otelDecisions),
  );
  repos.sync.setState('otel_events_dropped', String(randInt(3, 18)));
  repos.sync.setState('otel_last_event_at', `${addDays(today, -1)}T17:42:11.000Z`);

  const runStart = new Date(Date.now() - 4 * 3_600_000).toISOString();
  const runEnd = new Date(Date.now() - 4 * 3_600_000 + 90_000).toISOString();
  db.prepare(
    `INSERT INTO sync_runs (job_type, trigger, status, started_at, finished_at, rows_written)
     VALUES ('nightly', 'cron', 'success', ?, ?, ?)`,
  ).run(runStart, runEnd, dailyRows);

  // --- score snapshots: yesterday (actual) + 8 days ago (degraded) ---
  const to = today;
  const from = addDays(to, -29);
  const data = buildLeaderboardData(repos, { from, to });
  const yesterday = addDays(today, -1);
  const eightDaysAgo = addDays(today, -8);
  let snapshotCount = 0;
  for (const entry of data.entries) {
    if (entry.user.actorType !== 'user') continue;
    const earned = entry.badges.filter((b) => b.earned).map((b) => b.id);
    repos.sync.upsertSnapshot(yesterday, entry.user.id, SNAPSHOT_RANGE_KEY, entry.scores.composite, entry.segment, earned);

    // degraded past: slightly lower composite, some badges not yet earned, a few demotions
    const pastComposite =
      entry.scores.composite === null ? null : Math.max(0, Math.round((entry.scores.composite - randFloat(3, 12)) * 10) / 10);
    let pastBadges = [...earned];
    if (pastBadges.length > 0 && chance(0.35)) {
      pastBadges = pastBadges.slice(0, Math.max(0, pastBadges.length - randInt(1, 2)));
    }
    let pastSegment: string = entry.segment;
    if ((entry.segment === 'champion' || entry.segment === 'producer') && chance(0.25)) {
      pastSegment = entry.segment === 'champion' ? 'producer' : 'explorer';
    }
    repos.sync.upsertSnapshot(eightDaysAgo, entry.user.id, SNAPSHOT_RANGE_KEY, pastComposite, pastSegment, pastBadges);
    snapshotCount += 2;
  }

  // --- summary ---
  const count = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  console.log(`\nSeeded demo data into ${resolveFromRepoRoot(dbPath)}\n`);
  console.table([
    { entity: 'teams', count: count('teams') },
    { entity: 'users (total)', count: count('users') },
    { entity: 'users (rostered)', count: (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE in_roster=1`).get() as { n: number }).n },
    { entity: 'api-key actors', count: apiActors.length },
    { entity: 'non-adopters', count: devs.filter((d) => d.kind === 'none').length },
    { entity: 'usage_daily rows', count: count('usage_daily') },
    { entity: 'usage_daily_models rows', count: count('usage_daily_models') },
    { entity: 'usage_hourly rows', count: count('usage_hourly') },
    { entity: 'workspaces', count: count('workspaces') },
    { entity: 'api_keys', count: count('api_keys') },
    { entity: 'usage_api_keys_daily rows', count: count('usage_api_keys_daily') },
    { entity: 'cost_daily rows', count: count('cost_daily') },
    { entity: 'usage_dimensions_daily rows', count: count('usage_dimensions_daily') },
    { entity: 'otel_skill_daily rows', count: count('otel_skill_daily') },
    { entity: 'otel_agent_daily rows', count: count('otel_agent_daily') },
    { entity: 'otel_tool_daily rows', count: count('otel_tool_daily') },
    { entity: 'otel_activity_daily rows', count: count('otel_activity_daily') },
    { entity: 'otel_activity_hourly rows', count: count('otel_activity_hourly') },
    { entity: 'otel_sessions rows', count: count('otel_sessions') },
    { entity: 'otel_reliability_daily rows', count: count('otel_reliability_daily') },
    { entity: 'otel_governance_daily rows', count: count('otel_governance_daily') },
    { entity: 'otel_permission_mode_daily rows', count: count('otel_permission_mode_daily') },
    { entity: 'otel_mcp_daily rows', count: count('otel_mcp_daily') },
    { entity: 'otel_plugin_daily rows', count: count('otel_plugin_daily') },
    { entity: 'otel_token_mix_daily rows', count: count('otel_token_mix_daily') },
    { entity: 'score_snapshots', count: count('score_snapshots') },
    { entity: 'history days', count: DAYS_OF_HISTORY },
    { entity: 'hourly days', count: HOURLY_DAYS },
  ]);
  console.log(
    `range: ${historyStart} → ${today} · snapshots: ${yesterday} + ${eightDaysAgo} (${snapshotCount} rows) · hourly rows: ${hourlyRows} · model rows: ${modelRows}`,
  );
  console.log(
    `costs: ${costRows} line items · key usage: ${keyUsageRows} rows (${KEY_USAGE_DAYS}d) · dimensions: ${dimensionRows} rows (${DIMENSION_DAYS}d) · web searches: ${webSearchTotal}`,
  );
  console.log(
    `otel (${OTEL_DAYS}d, ${otelProfiles.length} users, ${otelProfiles.filter((p) => p.skills.length > 0).length} with skills): ` +
      `${otelSkillInvocations} skill invocations · ${otelAgentInvocations} agent runs · ${otelToolUses} tool uses · ${otelDecisions} decisions`,
  );
  console.log(
    `telemetry packs (${OTEL_DAYS}d): ${packActivityRows} activity days · ${packHourlyRows} live hours (48h) · ` +
      `${packSessionRows} sessions (14d) · ${packReliabilityRows} reliability rows · ${packGovernanceRows} governance days · ` +
      `${packMcpRows} mcp rows · ${packPluginRows} plugin rows · ${packTokenMixRows} token-mix rows\n`,
  );
  db.close();
}

main();
