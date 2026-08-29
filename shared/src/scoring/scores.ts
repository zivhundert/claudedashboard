import type { AxisScores, SegmentTier } from '../types.js';
import { score, percentile, clamp01 } from './normalize.js';
import { COVERAGE_MIN, type ImpactCoverage, type ScoreTargets } from './targets.js';

/**
 * Everything the scoring engine needs about one user for one date range.
 * The server assembles this from SQL aggregates; anything requiring raw rows
 * (streaks, night/early shares) is precomputed there.
 */
export interface ScoringInput {
  userId: number;
  sessions: number;
  activeDays: number;
  /** Sun–Thu days in the range */
  workdays: number;
  toolAccepted: number;
  toolRejected: number;
  linesAdded: number;
  commits: number;
  pullRequests: number;
  costCents: number;
  /** uncached input tokens (claude_code model_breakdown.tokens.input) */
  inputTokens: number;
  cacheReadTokens: number;
  /** total tokens per model, for Polyglot */
  modelTokens: Record<string, number>;
  /**
   * Share (0..1) of the user's activity that fell inside the night / early
   * window in org-local time, over the trailing 90d — NOT the selected range,
   * so a time-of-day habit reads the same in the 7D and 90D views. `null` =
   * no hourly data at all. "Activity" is prompt + API-request counts when OTEL
   * hourly telemetry exists, else token volume (see the server's assembler).
   */
  nightShare: number | null;
  earlyShare: number | null;
  /**
   * Distinct active days in the trailing 90d — the eligibility gate for the
   * two time badges. Range-scoped `activeDays` can't serve: a 7D view has at
   * most 7, which no minimum of 10 could ever clear.
   */
  habitActiveDays: number;
  /** trailing-90d consecutive active calendar days */
  currentStreak: number;
  /** longest such run inside the trailing 90d — what streak badges are earned on */
  bestStreak: number;
  /** total skill invocations in range (otel_skill_daily); 0 = no telemetry */
  skillInvocations: number;
  /** distinct skill names in range; collapses to 1 under minimal privacy mode */
  distinctSkills: number;
  /** MCP tool calls / failures in range (otel_mcp_daily) */
  mcpCalls: number;
  mcpFailures: number;
  /** MCP servers with >= 10 calls in range */
  activeMcpServers: number;
  /** subagent runs (otel_agent_daily invocations) and how many succeeded */
  subagentRuns: number;
  subagentSuccesses: number;
  /** distinct subagent_type values in range */
  distinctAgentTypes: number;
  /** switches into plan mode (otel_permission_mode_daily, mode='plan') */
  planModeEntries: number;
  /** ExitPlanMode accepted count (otel_tool_daily) — plans approved */
  plansAccepted: number;
  /**
   * All-time context compactions, NOT scoped to the selected range — like
   * `bestStreak`, this is an achievement measured over history, so the badge
   * doesn't disappear when someone switches the range picker to 7D.
   */
  compactions: number;
}

/**
 * Org-wide baselines, computed ONCE per range over the UNFILTERED
 * nonzero-usage population. Used by BADGES ONLY (percentile thresholds with
 * absolute floors, plus telemetry "not applicable" gates) — axis scores are
 * measured against fixed `ScoreTargets` and never against the population, so
 * one person's volume can't move anyone else's score. p80/p90 are robust
 * stats: a single outlier barely shifts them, unlike a max.
 */
export interface Baselines {
  /** kept for the pr_machine badge's "not applicable" gate (GitHub-only flow) */
  maxPullRequests: number;
  p80LinesAdded: number;
  p80Commits: number;
  p80PullRequests: number;
  p80LinesPerSession: number;
  p90Sessions: number;
  /** org-wide maxima for the value-delivery badges' "Not applicable" gates */
  maxSkillInvocations: number;
  maxDistinctSkills: number;
  maxMcpCalls: number;
  maxActiveMcpServers: number;
  maxSubagentRuns: number;
  maxDistinctAgentTypes: number;
  maxPlanModeEntries: number;
  maxPlansAccepted: number;
  /**
   * All-time org max compactions, over the WHOLE population rather than just
   * range-active users — it gates deep_diver's "Not applicable", and the stat
   * it mirrors is all-time, so a heavy compactor who happens to be idle this
   * range must not zero the gate for everyone.
   */
  maxCompactions: number;
  /** population size the baselines were computed over */
  sampleSize: number;
}

export const GUARDS = {
  /** below this many tool events, acceptance-based scores are low-confidence and halved */
  minToolEvents: 20,
  /** below this many sessions, efficiency is low-confidence and halved */
  minSessions: 10,
  /** below this many active days the composite is withheld */
  minActiveDays: 3,
  /** acceptance rate treated as "perfect" for the Trust axis */
  trustCalibration: 0.6,
} as const;

export function toolEvents(i: Pick<ScoringInput, 'toolAccepted' | 'toolRejected'>): number {
  return i.toolAccepted + i.toolRejected;
}

export function acceptanceRate(i: Pick<ScoringInput, 'toolAccepted' | 'toolRejected'>): number | null {
  const events = toolEvents(i);
  return events > 0 ? i.toolAccepted / events : null;
}

export function cacheRatio(i: Pick<ScoringInput, 'inputTokens' | 'cacheReadTokens'>): number | null {
  const denom = i.inputTokens + i.cacheReadTokens;
  return denom > 0 ? i.cacheReadTokens / denom : null;
}

export function linesPerSession(i: Pick<ScoringInput, 'linesAdded' | 'sessions'>): number {
  return i.sessions > 0 ? i.linesAdded / i.sessions : 0;
}

export function linesPerDollar(i: Pick<ScoringInput, 'linesAdded' | 'costCents'>): number {
  const dollars = i.costCents / 100;
  return dollars > 0 ? i.linesAdded / dollars : 0;
}

/** Models contributing >=5% of the user's total tokens. */
export function significantModelCount(modelTokens: Record<string, number>): number {
  const total = Object.values(modelTokens).reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  return Object.values(modelTokens).filter((t) => t / total >= 0.05).length;
}

export function computeBaselines(population: ScoringInput[]): Baselines {
  const active = population.filter((u) => u.sessions > 0);
  const max = (f: (u: ScoringInput) => number) => active.reduce((m, u) => Math.max(m, f(u)), 0);
  /** max over everyone, for baselines mirroring an all-time (range-independent) stat */
  const maxEver = (f: (u: ScoringInput) => number) => population.reduce((m, u) => Math.max(m, f(u)), 0);
  const values = (f: (u: ScoringInput) => number) => active.map(f);
  return {
    maxPullRequests: max((u) => u.pullRequests),
    p80LinesAdded: percentile(values((u) => u.linesAdded), 80),
    p80Commits: percentile(values((u) => u.commits), 80),
    p80PullRequests: percentile(values((u) => u.pullRequests), 80),
    p80LinesPerSession: percentile(values(linesPerSession), 80),
    p90Sessions: percentile(values((u) => u.sessions), 90),
    maxSkillInvocations: max((u) => u.skillInvocations),
    maxDistinctSkills: max((u) => u.distinctSkills),
    maxMcpCalls: max((u) => u.mcpCalls),
    maxActiveMcpServers: max((u) => u.activeMcpServers),
    maxSubagentRuns: max((u) => u.subagentRuns),
    maxDistinctAgentTypes: max((u) => u.distinctAgentTypes),
    maxPlanModeEntries: max((u) => u.planModeEntries),
    maxPlansAccepted: max((u) => u.plansAccepted),
    maxCompactions: maxEver((u) => u.compactions),
    sampleSize: active.length,
  };
}

/**
 * The four axis scores + composite. S() is `score()` — sqrt against a fixed
 * target (volume targets scale by the range's workdays), so every axis is a
 * pure function of the user's own row: nobody's score moves because someone
 * else worked more.
 *   Adoption   = 0.40·S(sessions) + 0.40·(activeDays/workdays·100) + 0.20·S(toolEvents)
 *   Impact     = 0.40·S(linesAdded) + 0.30·S(commits) + 0.30·S(PRs)   [coverage-gated]
 *   Efficiency = 0.35·S(lines/session) + 0.45·S(lines/$) + 0.20·(cacheRatio·100)
 *   Trust      = clamp(acceptanceRate / 0.60, 0, 1) · 100
 *   Composite  = 0.35·Adoption + 0.35·Impact + 0.15·Efficiency + 0.15·Trust
 */
export function computeAxes(i: ScoringInput, t: ScoreTargets, cov: ImpactCoverage): AxisScores {
  // max(1, …) guards weekend-only ranges, where 0 workdays would zero every target
  const wd = Math.max(1, i.workdays);
  const consistency = i.workdays > 0 ? Math.min(1, i.activeDays / i.workdays) * 100 : 0;
  const adoption =
    0.4 * score(i.sessions, t.perWorkday.sessions * wd) +
    0.4 * consistency +
    0.2 * score(toolEvents(i), t.perWorkday.toolEvents * wd);

  // A git-derived term only carries weight where the org can actually produce
  // it (PR counting is GitHub-only; ThetaRay-style Bitbucket orgs sit at ~0).
  // Coverage is the trailing-90d share of active users with a nonzero value —
  // below COVERAGE_MIN the term's weight redistributes proportionally over
  // the kept terms. Lines is the always-present fallback.
  const keepPrs = cov.pullRequests >= COVERAGE_MIN;
  const keepCommits = cov.commits >= COVERAGE_MIN;
  const keptWeight = 0.4 + (keepCommits ? 0.3 : 0) + (keepPrs ? 0.3 : 0);
  const impact =
    (0.4 / keptWeight) * score(i.linesAdded, t.perWorkday.linesAdded * wd) +
    (keepCommits ? (0.3 / keptWeight) * score(i.commits, t.perWorkday.commits * wd) : 0) +
    (keepPrs ? (0.3 / keptWeight) * score(i.pullRequests, t.perWorkday.pullRequests * wd) : 0);

  // lines/$ carries the axis: cost-efficiency is the signal people can act
  // on, while cache ratio saturates near 1.0 org-wide (a near-constant term).
  const ratio = cacheRatio(i) ?? 0;
  let efficiency =
    0.35 * score(linesPerSession(i), t.flat.linesPerSession) +
    0.45 * score(linesPerDollar(i), t.flat.linesPerDollar) +
    0.2 * (ratio * 100);
  const efficiencyLowConfidence = i.sessions < GUARDS.minSessions;
  if (efficiencyLowConfidence) efficiency /= 2;

  const rate = acceptanceRate(i);
  let trust = rate === null ? 0 : clamp01(rate / GUARDS.trustCalibration) * 100;
  const trustLowConfidence = toolEvents(i) < GUARDS.minToolEvents;
  if (trustLowConfidence) trust /= 2;

  const composite =
    i.activeDays < GUARDS.minActiveDays
      ? null
      : 0.35 * adoption + 0.35 * impact + 0.15 * efficiency + 0.15 * trust;

  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    adoption: round1(adoption),
    impact: round1(impact),
    efficiency: round1(efficiency),
    trust: round1(trust),
    composite: composite === null ? null : round1(composite),
    trustLowConfidence,
    efficiencyLowConfidence,
  };
}

/** Tier boundaries — the quadrant chart draws its lines from these, so the UI can't drift. */
export const SEGMENT_THRESHOLDS = {
  champion: { adoption: 80, impact: 80 },
  producer: { adoption: 50, impact: 40 },
  starterBelowAdoption: 20,
} as const;

/** Two-axis segmentation, evaluated top-down. */
export function segmentFor(scores: Pick<AxisScores, 'adoption' | 'impact'>): SegmentTier {
  const s = SEGMENT_THRESHOLDS;
  if (scores.adoption >= s.champion.adoption && scores.impact >= s.champion.impact) return 'champion';
  if (scores.adoption >= s.producer.adoption && scores.impact >= s.producer.impact) return 'producer';
  if (scores.adoption < s.starterBelowAdoption) return 'starter';
  return 'explorer';
}
