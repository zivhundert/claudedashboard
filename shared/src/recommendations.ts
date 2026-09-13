/**
 * AI coach contract — the compact, anonymous snapshot the model sees, the
 * payload it must return, and the pure helpers around them (deterministic
 * serialisation, the thin-data rule, output sanitising). Server, web and the
 * unit tests share this file so the prompt, the validator and the UI never
 * drift apart. Nothing here knows about the LLM provider.
 *
 * Framing: the coach looks at ONE developer on their own terms — how they use
 * Claude Code and how to get more out of it. The input therefore carries no
 * scores, org medians, targets, ranks or badges: nothing to compare against.
 */
import type { DateRange, LeaderboardEntry, ModelUsage, ToolName } from './types.js';
import { GUARDS } from './scoring/scores.js';
import { COVERAGE_MIN, type ImpactCoverage } from './scoring/targets.js';

/**
 * What a recommendation improves — areas of working with Claude Code, not
 * dashboard score axes:
 *   adoption   using Claude Code more regularly and for more of the work
 *   efficiency context, cache, cost and session hygiene
 *   quality    edits that get kept: planning, conventions, smaller asks
 *   toolkit    skills, subagents, MCP servers, permission modes
 *   delivery   finishing tasks end to end inside Claude Code (tests, commits, PRs)
 */
export type RecommendationArea = 'adoption' | 'efficiency' | 'quality' | 'toolkit' | 'delivery';
export const RECOMMENDATION_AREAS: readonly RecommendationArea[] = ['adoption', 'efficiency', 'quality', 'toolkit', 'delivery'];

/** Bump when RecommendationInput changes shape — cached rows stop matching and regenerate. */
export const RECOMMENDATION_INPUT_VERSION = 2;

/** The coach needs at least this many calendar days of data; shorter ranges are refused before any model call. */
export const COACH_MIN_RANGE_DAYS = 7;

export interface NamedCount {
  name: string;
  count: number;
  /** failures ÷ count, whole percent; null when there is nothing to divide */
  failurePct: number | null;
}

/** Telemetry-pack counters for one person; null fields = that pack has no rows for them. */
export interface RecommendationTelemetry {
  activeHours: number | null;
  prompts: number | null;
  avgSessionMin: number | null;
  apiErrorRatePct: number | null;
  refusals: number;
  compactions: number;
  autoApprovedSharePct: number | null;
  rejects: number;
  aborts: number;
  planModeEntries: number;
  skillInvocations: number;
  distinctSkills: number;
  subagentRuns: number;
  mcpCalls: number;
  mcpFailures: number;
  activeMcpServers: number;
  /** most-used skills (slash commands / packaged workflows), top 5 */
  topSkills: NamedCount[];
  /** subagent types run, top 5, with failure rate */
  subagents: NamedCount[];
  /** MCP servers called, top 5, with failure rate */
  mcpServers: NamedCount[];
}

/**
 * Everything the model may reason about. Numbers only — no name, email,
 * team, prompts or file paths. Values are pre-rounded so live-telemetry drift
 * does not churn the cache hash.
 */
export interface RecommendationInput {
  version: number;
  range: { from: string; to: string; days: number; workdays: number };
  activity: {
    sessions: number;
    activeDays: number;
    consistencyPct: number;
    sessionsPerWorkday: number;
    streakCurrent: number;
    streakBest: number;
    trendSessions14dPct: number | null;
  };
  output: {
    linesAdded: number;
    linesRemoved: number;
    commits: number;
    pullRequests: number;
    linesPerSession: number;
    linesPerDollar: number;
  };
  /** edit decisions: what the person kept vs rejected, per tool */
  edits: {
    accepted: number;
    rejected: number;
    acceptanceRatePct: number | null;
    perTool: Record<ToolName, { accepted: number; rejected: number }>;
    /** fewer than GUARDS.minToolEvents decisions — rates are noisy */
    fewDecisions: boolean;
  };
  cost: {
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheRatioPct: number | null;
    significantModels: number;
    topModels: Array<{ model: string; sharePct: number }>;
  };
  /** what this installation can even see — so the coach never asks for the invisible */
  context: {
    /** commits are attributed in this org (git tooling reports them) */
    commitsTracked: boolean;
    /** pull requests are attributed in this org (GitHub tooling) */
    pullRequestsTracked: boolean;
  };
  telemetry: RecommendationTelemetry | null;
}

export interface Recommendation {
  /** kebab-case slug, unique within the response */
  id: string;
  title: string;
  /** cites concrete numbers from the input */
  why: string;
  /** a Claude-Code-specific action for this week */
  tryThis: string;
  expectedEffect: { area: RecommendationArea; note: string };
  /** dotted keys into RecommendationInput, e.g. "edits.acceptanceRatePct" */
  evidence: string[];
}

export interface RecommendationStrength {
  title: string;
  why: string;
  evidence: string[];
}

/** What the model returns (validated server-side, then sanitised). */
export interface RecommendationsPayload {
  /** 1–2 sentences: how this person uses Claude Code in this range, in their own terms */
  summary: string;
  dataThin: boolean;
  strengths: RecommendationStrength[];
  recommendations: Recommendation[];
}

/** GET /api/users/:id/recommendations */
export interface RecommendationsResponse extends RecommendationsPayload {
  userId: number;
  range: DateRange;
  generatedAt: string;
  model: string;
  cached: boolean;
  inputHash: string;
  /** set when a fresh generation failed and a cached copy was served instead */
  staleReason: string | null;
  /** fixed sentence shown under the card */
  disclosure: string;
  /** exactly what the model saw — powers the evidence chips and the "what was sent" view */
  input: RecommendationInput;
}

/** GET/PUT /api/coach/prompt — the editable guidance half of the system prompt. */
export interface CoachPromptResponse {
  defaultGuidance: string;
  /** null = the built-in default is in force */
  customGuidance: string | null;
  effectiveGuidance: string;
  /** locked tail always appended to the guidance — the output JSON the parser expects */
  outputContract: string;
  updatedAt: string | null;
  /** a key is configured AND the Settings toggle is on (the prompt is used) */
  enabled: boolean;
  /** ADMIN_PASSWORD is set on the server, so saving is possible */
  adminConfigured: boolean;
}

/** Token usage of one generation, as reported by the endpoint. */
export interface CoachUsageTotals {
  generations: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** priced with the AppSettings.aiCoachPrice* rates in force */
  estimatedUsd: number;
}

export type CoachUsageWindowKey = 'today' | '7d' | '30d' | 'all';

/** GET /api/coach/usage — what the coach has cost so far. */
export interface CoachUsageResponse {
  windows: Array<{ key: CoachUsageWindowKey; label: string; since: string | null } & CoachUsageTotals>;
  /** $ per million tokens used for estimatedUsd (from Settings) */
  pricing: { inputUsdPerMTok: number; outputUsdPerMTok: number; cacheReadUsdPerMTok: number };
  lastGeneratedAt: string | null;
}

/** Cost of one generation at the given $/MTok rates. Cache writes are billed at the input rate. */
export function priceGeneration(
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  pricing: CoachUsageResponse['pricing'],
): number {
  const perTok = (usd: number) => usd / 1_000_000;
  return (
    (usage.inputTokens + usage.cacheWriteTokens) * perTok(pricing.inputUsdPerMTok) +
    usage.outputTokens * perTok(pricing.outputUsdPerMTok) +
    usage.cacheReadTokens * perTok(pricing.cacheReadUsdPerMTok)
  );
}

export const MAX_RECOMMENDATIONS = 5;
export const MIN_RECOMMENDATIONS = 3;
export const MAX_STRENGTHS = 2;

// ---------------------------------------------------------------------------
// Input assembly (pure; the server gathers the rows, this shapes and rounds)
// ---------------------------------------------------------------------------

const pct = (ratio: number): number => Math.round(ratio * 100);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const usd = (cents: number): number => Math.round(cents) / 100;
const kTokens = (n: number): number => Math.round(n / 1000) * 1000;

export interface BuildRecommendationInputArgs {
  range: DateRange;
  entry: LeaderboardEntry;
  coverage: ImpactCoverage;
  models: ModelUsage[];
  telemetry: RecommendationTelemetry | null;
}

/** Inclusive calendar days in a 'YYYY-MM-DD' range; 1 when unparsable. */
export function daysInclusive(range: DateRange): number {
  const ms = Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86_400_000) + 1) : 1;
}

/** true when the range is long enough for the coach to say anything useful. */
export function isCoachableRange(range: DateRange): boolean {
  return daysInclusive(range) >= COACH_MIN_RANGE_DAYS;
}

export function buildRecommendationInput(args: BuildRecommendationInputArgs): RecommendationInput {
  const { range, entry, coverage, models, telemetry } = args;
  const m = entry.metrics;
  const wd = Math.max(1, m.workdays);
  const days = daysInclusive(range);
  const totalTokens = models.reduce((s, x) => s + tokenSum(x), 0);
  const topModels = [...models]
    .map((x) => ({ model: x.model, share: totalTokens > 0 ? tokenSum(x) / totalTokens : 0 }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .map((x) => ({ model: x.model, sharePct: pct(x.share) }));
  const costDollars = m.costCents / 100;
  const decisions = m.toolAccepted + m.toolRejected;

  return {
    version: RECOMMENDATION_INPUT_VERSION,
    range: { from: range.from, to: range.to, days, workdays: m.workdays },
    activity: {
      sessions: m.sessions,
      activeDays: m.activeDays,
      consistencyPct: m.workdays > 0 ? pct(Math.min(1, m.activeDays / m.workdays)) : 0,
      sessionsPerWorkday: r1(m.sessions / wd),
      streakCurrent: entry.streak.current,
      streakBest: entry.streak.best,
      trendSessions14dPct: entry.trendDeltaPct === null ? null : Math.round(entry.trendDeltaPct),
    },
    output: {
      linesAdded: m.linesAdded,
      linesRemoved: m.linesRemoved,
      commits: m.commits,
      pullRequests: m.pullRequests,
      linesPerSession: m.sessions > 0 ? r1(m.linesAdded / m.sessions) : 0,
      linesPerDollar: costDollars > 0 ? r1(m.linesAdded / costDollars) : 0,
    },
    edits: {
      accepted: m.toolAccepted,
      rejected: m.toolRejected,
      acceptanceRatePct: m.acceptanceRate === null ? null : pct(m.acceptanceRate),
      perTool: m.perTool,
      fewDecisions: decisions < GUARDS.minToolEvents,
    },
    cost: {
      costUsd: usd(m.costCents),
      inputTokens: kTokens(m.tokens.input),
      outputTokens: kTokens(m.tokens.output),
      cacheReadTokens: kTokens(m.tokens.cacheRead),
      cacheRatioPct: m.cacheRatio === null ? null : pct(m.cacheRatio),
      significantModels: m.significantModels,
      topModels,
    },
    context: {
      commitsTracked: coverage.commits >= COVERAGE_MIN,
      pullRequestsTracked: coverage.pullRequests >= COVERAGE_MIN,
    },
    telemetry: telemetry === null ? null : roundTelemetry(telemetry),
  };
}

function tokenSum(x: ModelUsage): number {
  return x.tokens.input + x.tokens.output + x.tokens.cacheRead + x.tokens.cacheCreation;
}

const TOP_N = 5;

function topNamed(list: NamedCount[]): NamedCount[] {
  return [...list]
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_N)
    .map((x) => ({ name: x.name, count: x.count, failurePct: x.failurePct === null ? null : Math.round(x.failurePct) }));
}

function roundTelemetry(t: RecommendationTelemetry): RecommendationTelemetry {
  return {
    ...t,
    activeHours: t.activeHours === null ? null : r1(t.activeHours),
    avgSessionMin: t.avgSessionMin === null ? null : Math.round(t.avgSessionMin),
    apiErrorRatePct: t.apiErrorRatePct === null ? null : r1(t.apiErrorRatePct),
    autoApprovedSharePct: t.autoApprovedSharePct === null ? null : Math.round(t.autoApprovedSharePct),
    topSkills: topNamed(t.topSkills),
    subagents: topNamed(t.subagents),
    mcpServers: topNamed(t.mcpServers),
  };
}

// ---------------------------------------------------------------------------
// Determinism + validation helpers
// ---------------------------------------------------------------------------

/** JSON with sorted object keys and no whitespace — the hash input and the user message. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Too little activity to coach on — mirrors the composite-score guard. */
export function isThinData(input: RecommendationInput): boolean {
  return input.activity.activeDays < GUARDS.minActiveDays;
}

/** Every dotted path in the input (intermediate objects and leaves; arrays count as leaves). */
export function collectEvidenceKeys(input: RecommendationInput): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown, prefix: string): void => {
    if (prefix) out.add(prefix);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        walk(child, prefix ? `${prefix}.${k}` : k);
      }
    }
  };
  walk(input, '');
  return out;
}

export function getEvidenceValue(input: RecommendationInput, key: string): unknown {
  let cur: unknown = input;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'recommendation'
  );
}

/**
 * Make model output safe to display: drop evidence keys that are not in the
 * input, drop items left without evidence, dedupe ids, clamp counts, and
 * force dataThin when the guard says so. Pure — never throws.
 */
export function sanitizeRecommendations(
  payload: RecommendationsPayload,
  input: RecommendationInput,
): RecommendationsPayload {
  const valid = collectEvidenceKeys(input);
  const keep = (keys: unknown): string[] =>
    Array.isArray(keys) ? [...new Set(keys.filter((k): k is string => typeof k === 'string' && valid.has(k)))] : [];
  const seen = new Set<string>();
  const recommendations: Recommendation[] = [];
  for (const r of payload.recommendations ?? []) {
    const evidence = keep(r.evidence);
    if (evidence.length === 0) continue;
    if (!RECOMMENDATION_AREAS.includes(r.expectedEffect?.area)) continue;
    let id = slugify(r.id || r.title);
    let n = 2;
    while (seen.has(id)) id = `${slugify(r.id || r.title)}-${n++}`;
    seen.add(id);
    recommendations.push({ ...r, id, evidence });
    if (recommendations.length >= MAX_RECOMMENDATIONS) break;
  }
  const strengths: RecommendationStrength[] = [];
  for (const s of payload.strengths ?? []) {
    const evidence = keep(s.evidence);
    if (evidence.length === 0) continue;
    strengths.push({ ...s, evidence });
    if (strengths.length >= MAX_STRENGTHS) break;
  }
  return {
    summary: (payload.summary ?? '').trim(),
    dataThin: Boolean(payload.dataThin) || isThinData(input),
    strengths,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers for evidence chips
// ---------------------------------------------------------------------------

export const RECOMMENDATION_AREA_LABELS: Record<RecommendationArea, string> = {
  adoption: 'Adoption',
  efficiency: 'Efficiency',
  quality: 'Quality',
  toolkit: 'Toolkit',
  delivery: 'Delivery',
};

export const RECOMMENDATION_EVIDENCE_LABELS: Record<string, string> = {
  'activity.sessions': 'Sessions',
  'activity.activeDays': 'Active days',
  'activity.consistencyPct': 'Consistency',
  'activity.sessionsPerWorkday': 'Sessions / workday',
  'activity.streakCurrent': 'Current streak',
  'activity.streakBest': 'Best streak',
  'activity.trendSessions14dPct': 'Sessions trend (14d)',
  'output.linesAdded': 'Lines added',
  'output.linesRemoved': 'Lines removed',
  'output.commits': 'Commits',
  'output.pullRequests': 'Pull requests',
  'output.linesPerSession': 'Lines / session',
  'output.linesPerDollar': 'Lines / $',
  'edits.accepted': 'Edits accepted',
  'edits.rejected': 'Edits rejected',
  'edits.acceptanceRatePct': 'Acceptance rate',
  'edits.perTool': 'Per tool',
  'edits.fewDecisions': 'Few decisions',
  'cost.costUsd': 'Cost',
  'cost.inputTokens': 'Input tokens',
  'cost.outputTokens': 'Output tokens',
  'cost.cacheReadTokens': 'Cache-read tokens',
  'cost.cacheRatioPct': 'Cache hit rate',
  'cost.significantModels': 'Models used',
  'cost.topModels': 'Top models',
  'context.commitsTracked': 'Commits tracked',
  'context.pullRequestsTracked': 'PRs tracked',
  'telemetry.activeHours': 'Engaged hours',
  'telemetry.prompts': 'Prompts',
  'telemetry.avgSessionMin': 'Avg session (min)',
  'telemetry.apiErrorRatePct': 'API error rate',
  'telemetry.refusals': 'Refusals',
  'telemetry.compactions': 'Compactions',
  'telemetry.autoApprovedSharePct': 'Auto-approved share',
  'telemetry.rejects': 'Permission rejects',
  'telemetry.aborts': 'Permission aborts',
  'telemetry.planModeEntries': 'Plan-mode entries',
  'telemetry.skillInvocations': 'Skill invocations',
  'telemetry.distinctSkills': 'Distinct skills',
  'telemetry.subagentRuns': 'Subagent runs',
  'telemetry.mcpCalls': 'MCP calls',
  'telemetry.mcpFailures': 'MCP failures',
  'telemetry.activeMcpServers': 'Active MCP servers',
  'telemetry.topSkills': 'Top skills',
  'telemetry.subagents': 'Subagents',
  'telemetry.mcpServers': 'MCP servers',
};

export function evidenceLabel(key: string): string {
  const known = RECOMMENDATION_EVIDENCE_LABELS[key];
  if (known) return known;
  const last = key.split('.').pop() ?? key;
  return last.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}

export function formatEvidenceValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') {
    if (key.endsWith('Pct')) return `${value}%`;
    if (key.endsWith('Usd')) return `$${value.toFixed(2)}`;
    return value.toLocaleString('en-US');
  }
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // named lists read better as names than as "3 items"
    const names = value
      .map((v) => (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? (v as { name: string }).name : null))
      .filter((n): n is string => n !== null);
    if (names.length === value.length && names.length > 0) return names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : '');
    return `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  return '…';
}
