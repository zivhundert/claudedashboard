/**
 * Gathers everything the coach may reason about for one person and shapes it
 * into the compact, anonymous RecommendationInput (shared contract), plus a
 * SHA-256 of its canonical serialisation so the cache can tell "same numbers"
 * from "numbers moved". Reuses the leaderboard assembler for the per-person
 * metrics (only that person's entry is used — no medians, no targets) and the
 * telemetry repos for the optional counters and the named skills / subagents /
 * MCP servers.
 */
import { createHash } from 'node:crypto';
import {
  buildRecommendationInput,
  stableStringify,
  type ModelUsage,
  type NamedCount,
  type RecommendationInput,
  type RecommendationTelemetry,
} from '@dash/shared';
import type { Repos } from '../repos';
import { buildLeaderboardData, entryForUser, type RangeParams } from './scoring';
import { errorRate, mean } from './packMath';

export interface AssembledInput {
  input: RecommendationInput;
  hash: string;
}

export function hashInput(input: RecommendationInput): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** null when the person has no scoring entry at all (unknown user). */
export function buildRecommendationInputForUser(
  repos: Repos,
  userId: number,
  range: RangeParams,
): AssembledInput | null {
  const data = buildLeaderboardData(repos, range);
  const entry = entryForUser(data, userId);
  if (!entry) return null;

  const models: ModelUsage[] = repos.usage.modelTotals(range.from, range.to, undefined, userId).map((r) => ({
    model: r.model,
    tokens: {
      input: r.input_tokens,
      output: r.output_tokens,
      cacheRead: r.cache_read_tokens,
      cacheCreation: r.cache_creation_tokens,
    },
    costCents: r.cost_cents,
  }));

  const input = buildRecommendationInput({
    range,
    entry,
    coverage: data.coverage,
    models,
    telemetry: telemetryFor(repos, userId, range),
  });
  return { input, hash: hashInput(input) };
}

const failurePct = (failures: number, total: number): number | null => (total > 0 ? (failures / total) * 100 : null);

function telemetryFor(repos: Repos, userId: number, range: RangeParams): RecommendationTelemetry | null {
  const scope = { userId };
  const packs = repos.otelPacks;
  const { from, to } = range;
  const hasAny =
    packs.hasRows(['otel_activity_daily', 'otel_reliability_daily', 'otel_governance_daily', 'otel_mcp_daily'], from, to, scope) ||
    repos.otel.hasData(from, to, scope);
  if (!hasAny) return null;

  const act = packs.activityTotals(from, to, scope);
  const durations = packs.sessionDurations(from, to, scope).map((d) => d.dur_ms);
  const rel = packs.reliabilityTotals(from, to, scope);
  const gov = packs.governanceTotals(from, to, scope);
  const modes = packs.permissionModes(from, to, scope);
  const mcp = packs.mcpServers(from, to, scope);
  const otel = repos.otel.totals(from, to, scope);

  const auto = gov.src_config + gov.src_hook + gov.src_user_permanent;
  const decisions = auto + gov.src_user_temporary + gov.src_user_abort + gov.src_user_reject;
  const errRate = errorRate(rel.api_requests, rel.api_errors);
  const avgSession = mean(durations);

  // Named lists: tool/skill/server names are configuration, not personal data
  // (the privacy filter already decided what names reach the tables).
  const topSkills: NamedCount[] = repos.otel
    .skillTotals(from, to, scope)
    .map((s) => ({ name: s.skill_name, count: s.invocations, failurePct: null }));
  const subagents: NamedCount[] = repos.otel
    .agentTotals(from, to, scope)
    .map((a) => ({ name: a.subagent_type, count: a.invocations, failurePct: failurePct(a.failure, a.success + a.failure) }));
  const mcpServers: NamedCount[] = mcp.map((s) => ({
    name: s.server_name,
    count: s.tool_calls,
    failurePct: failurePct(s.tool_failures, s.tool_calls),
  }));

  return {
    activeHours: act.active_user_s > 0 ? act.active_user_s / 3600 : null,
    prompts: act.prompts > 0 ? act.prompts : null,
    avgSessionMin: avgSession === null ? null : avgSession / 60_000,
    apiErrorRatePct: errRate === null ? null : errRate * 100,
    refusals: rel.refusals,
    compactions: rel.compactions,
    autoApprovedSharePct: decisions > 0 ? (auto / decisions) * 100 : null,
    rejects: gov.src_user_reject,
    aborts: gov.src_user_abort,
    planModeEntries: modes.find((m) => m.mode === 'plan')?.changes ?? 0,
    skillInvocations: otel.skillInvocations,
    distinctSkills: otel.distinctSkills,
    subagentRuns: otel.agentInvocations,
    mcpCalls: mcp.reduce((s, r) => s + r.tool_calls, 0),
    mcpFailures: mcp.reduce((s, r) => s + r.tool_failures, 0),
    activeMcpServers: mcp.filter((r) => r.tool_calls >= 10).length,
    topSkills,
    subagents,
    mcpServers,
  };
}
