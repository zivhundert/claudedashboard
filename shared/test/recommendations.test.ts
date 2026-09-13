import { describe, expect, it } from 'vitest';
import {
  COACH_MIN_RANGE_DAYS,
  buildRecommendationInput,
  collectEvidenceKeys,
  daysInclusive,
  isCoachableRange,
  isThinData,
  priceGeneration,
  sanitizeRecommendations,
  stableStringify,
  type RecommendationInput,
  type RecommendationsPayload,
} from '../src/recommendations.js';
import type { LeaderboardEntry, UserDto } from '../src/types.js';

function makeEntry(overrides: Partial<LeaderboardEntry['metrics']> = {}, activeDays = 15): LeaderboardEntry {
  const user = { id: 7, name: 'Test Person', email: 't@example.dev' } as unknown as UserDto;
  return {
    user,
    metrics: {
      sessions: 40,
      activeDays,
      workdays: 22,
      linesAdded: 5000,
      linesRemoved: 900,
      commits: 20,
      pullRequests: 6,
      toolAccepted: 80,
      toolRejected: 20,
      acceptanceRate: 0.8,
      perTool: {
        edit: { accepted: 50, rejected: 10 },
        multi_edit: { accepted: 10, rejected: 5 },
        write: { accepted: 15, rejected: 5 },
        notebook: { accepted: 5, rejected: 0 },
      },
      costCents: 8412.6,
      tokens: { input: 1_000_499, output: 250_000, cacheRead: 3_000_000, cacheCreation: 100_000 },
      cacheRatio: 0.6234,
      significantModels: 2,
      ...overrides,
    },
    scores: {
      adoption: 61.26,
      impact: 55.04,
      efficiency: 70.1,
      trust: 100,
      composite: 66.3,
      trustLowConfidence: false,
      efficiencyLowConfidence: false,
    },
    segment: 'producer',
    badges: [
      { id: 'ship_it', earned: true, progress: 1, detail: '20 / 15 commits' },
      { id: 'pr_machine', earned: false, progress: 0.6, detail: '6 / 10 PRs' },
      { id: 'cache_master', earned: false, progress: 0.89, detail: '62% / 70%' },
      { id: 'night_owl', earned: false, progress: 0.1, detail: '3% / 30%' },
    ],
    streak: { current: 6, best: 12 },
    sparkline: [1, 2, 3],
    trendDeltaPct: 12.4,
    lastActiveDate: '2026-09-12',
  } as LeaderboardEntry;
}

function build(entry = makeEntry()): RecommendationInput {
  return buildRecommendationInput({
    range: { from: '2026-08-15', to: '2026-09-13' },
    entry,
    coverage: { commits: 0.8, pullRequests: 0.1 },
    models: [
      { model: 'claude-opus-5', tokens: { input: 700_000, output: 200_000, cacheRead: 2_000_000, cacheCreation: 100_000 }, costCents: 7000 },
      { model: 'claude-haiku-4-5', tokens: { input: 300_499, output: 50_000, cacheRead: 1_000_000, cacheCreation: 0 }, costCents: 1412.6 },
    ],
    telemetry: {
      activeHours: 12.345,
      prompts: 300,
      avgSessionMin: 41.7,
      apiErrorRatePct: 1.234,
      refusals: 1,
      compactions: 4,
      autoApprovedSharePct: 55.5,
      rejects: 3,
      aborts: 1,
      planModeEntries: 2,
      skillInvocations: 10,
      distinctSkills: 3,
      subagentRuns: 5,
      mcpCalls: 40,
      mcpFailures: 2,
      activeMcpServers: 1,
      topSkills: [
        { name: 'review', count: 6, failurePct: null },
        { name: 'commit', count: 4, failurePct: null },
        { name: 'unused', count: 0, failurePct: null },
      ],
      subagents: [{ name: 'Explore', count: 5, failurePct: 20.4 }],
      mcpServers: [
        { name: 'jira', count: 30, failurePct: 6.67 },
        { name: 'github', count: 10, failurePct: 0 },
      ],
    },
  });
}

describe('buildRecommendationInput', () => {
  it('rounds, names the named lists, carries no identity and nothing to compare against', () => {
    const input = build();
    expect(input.version).toBe(2);
    expect(input.range).toEqual({ from: '2026-08-15', to: '2026-09-13', days: 30, workdays: 22 });
    expect(input.activity.consistencyPct).toBe(68);
    expect(input.activity.sessionsPerWorkday).toBe(1.8);
    expect(input.cost.costUsd).toBe(84.13);
    expect(input.cost.inputTokens).toBe(1_000_000);
    expect(input.cost.cacheRatioPct).toBe(62);
    expect(input.edits).toMatchObject({ accepted: 80, rejected: 20, acceptanceRatePct: 80, fewDecisions: false });
    expect(input.context).toEqual({ commitsTracked: true, pullRequestsTracked: false }); // PR coverage 0.1 < 0.25
    expect(input.cost.topModels[0]).toEqual({ model: 'claude-opus-5', sharePct: 69 });
    expect(input.telemetry?.activeHours).toBe(12.3);
    expect(input.telemetry?.avgSessionMin).toBe(42);
    expect(input.telemetry?.topSkills).toEqual([
      { name: 'review', count: 6, failurePct: null },
      { name: 'commit', count: 4, failurePct: null },
    ]); // zero-count entries dropped
    expect(input.telemetry?.subagents).toEqual([{ name: 'Explore', count: 5, failurePct: 20 }]);
    expect(input.telemetry?.mcpServers[0]).toEqual({ name: 'jira', count: 30, failurePct: 7 });
    const json = JSON.stringify(input);
    expect(json).not.toMatch(/Test Person|example\.dev/);
    // the stand-alone framing: no scores, medians, targets, ranks or badges reach the model
    expect(json).not.toMatch(/orgMedian|targets|badges|composite|segment|"scores"/);
  });

  it('flags few edit decisions', () => {
    expect(build(makeEntry({ toolAccepted: 10, toolRejected: 5 })).edits.fewDecisions).toBe(true);
  });

  it('is deterministic under key order and sub-rounding drift', () => {
    const a = stableStringify(build());
    const b = stableStringify(build(makeEntry({ costCents: 8412.9, cacheRatio: 0.6239 })));
    expect(a).toBe(b);
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  it('flags thin data below the composite guard', () => {
    expect(isThinData(build())).toBe(false);
    expect(isThinData(build(makeEntry({}, 2)))).toBe(true);
  });

  it('counts inclusive days and gates the coach at 7', () => {
    expect(daysInclusive({ from: '2026-09-13', to: '2026-09-13' })).toBe(1);
    expect(daysInclusive({ from: '2026-09-01', to: '2026-09-07' })).toBe(7);
    expect(COACH_MIN_RANGE_DAYS).toBe(7);
    expect(isCoachableRange({ from: '2026-09-01', to: '2026-09-06' })).toBe(false);
    expect(isCoachableRange({ from: '2026-09-01', to: '2026-09-07' })).toBe(true);
  });
});

describe('sanitizeRecommendations', () => {
  const input = build();
  const payload: RecommendationsPayload = {
    summary: '  Daily habit, edits mostly kept.  ',
    dataThin: false,
    strengths: [
      { title: 'Habit', why: 'x', evidence: ['activity.consistencyPct', 'made.up.key'] },
      { title: 'No evidence', why: 'y', evidence: ['nope'] },
      { title: 'Third', why: 'z', evidence: ['edits.acceptanceRatePct'] },
    ],
    recommendations: [
      { id: '', title: 'Commit more', why: 'w', tryThis: 't', expectedEffect: { area: 'delivery', note: '' }, evidence: ['output.commits'] },
      { id: 'commit-more', title: 'Commit more', why: 'w', tryThis: 't', expectedEffect: { area: 'delivery', note: '' }, evidence: ['output.commits'] },
      { id: 'bad-area', title: 'Bad', why: 'w', tryThis: 't', expectedEffect: { area: 'impact' as 'delivery', note: '' }, evidence: ['output.commits'] },
      { id: 'ghost', title: 'Ghost', why: 'w', tryThis: 't', expectedEffect: { area: 'quality', note: '' }, evidence: ['not.real'] },
      { id: 'r4', title: 'Four', why: 'w', tryThis: 't', expectedEffect: { area: 'quality', note: '' }, evidence: ['edits.acceptanceRatePct'] },
      { id: 'r5', title: 'Five', why: 'w', tryThis: 't', expectedEffect: { area: 'efficiency', note: '' }, evidence: ['cost.cacheRatioPct'] },
      { id: 'r6', title: 'Six', why: 'w', tryThis: 't', expectedEffect: { area: 'toolkit', note: '' }, evidence: ['telemetry.mcpServers'] },
      { id: 'r7', title: 'Seven', why: 'w', tryThis: 't', expectedEffect: { area: 'adoption', note: '' }, evidence: ['activity.sessions'] },
    ],
  };

  it('drops unknown evidence, evidence-less items, bad areas; dedupes ids; clamps counts', () => {
    const out = sanitizeRecommendations(payload, input);
    expect(out.summary).toBe('Daily habit, edits mostly kept.');
    expect(out.strengths).toHaveLength(2);
    expect(out.strengths[0]?.evidence).toEqual(['activity.consistencyPct']);
    expect(out.recommendations.map((r) => r.id)).toEqual(['commit-more', 'commit-more-2', 'r4', 'r5', 'r6']);
    expect(out.dataThin).toBe(false);
  });

  it('forces dataThin when the guard says so', () => {
    const thin = build(makeEntry({}, 1));
    expect(sanitizeRecommendations({ ...payload, dataThin: false }, thin).dataThin).toBe(true);
  });

  it('exposes intermediate and leaf paths as valid evidence', () => {
    const keys = collectEvidenceKeys(input);
    expect(keys.has('edits')).toBe(true);
    expect(keys.has('edits.perTool.edit.accepted')).toBe(true);
    expect(keys.has('telemetry.mcpCalls')).toBe(true);
    expect(keys.has('telemetry.mcpServers')).toBe(true);
    expect(keys.has('user')).toBe(false);
  });
});

describe('priceGeneration', () => {
  it('bills cache writes at the input rate and cache reads at their own', () => {
    const usd = priceGeneration(
      { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 500_000 },
      { inputUsdPerMTok: 5, outputUsdPerMTok: 25, cacheReadUsdPerMTok: 0.5 },
    );
    expect(usd).toBeCloseTo(1.5 * 5 + 0.1 * 25 + 2 * 0.5, 6);
  });
});
