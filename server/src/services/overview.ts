import {
  addDays,
  daysBetween,
  weekStartOf,
  type ModelDailyCost,
  type ModelUsage,
  type OverviewDailyPoint,
  type OverviewKpis,
  type OverviewResponse,
  type TerminalMixEntry,
} from '@dash/shared';
import type { Repos } from '../repos';
import type { Granularity } from '../repos/usageRepo';
import { hourIsoOf, localHourOfUtc, orgWeekStart, todayLocal } from '../util/time';
import type { RangeParams } from './scoring';

export interface OverviewQuery extends RangeParams {
  teamId?: number;
  /** bucket size for the `daily` series; day (default) preserves the old shape */
  gran?: Granularity;
}

/** Start date of the bucket containing `date`; weeks start on WEEK_START, as in the SQL buckets. */
function bucketStartOf(date: string, gran: Granularity): string {
  if (gran === 'day') return date;
  if (gran === 'week') return weekStartOf(date, orgWeekStart());
  return `${date.slice(0, 7)}-01`;
}

function nextBucketStart(bucket: string, gran: Granularity): string {
  if (gran === 'day') return addDays(bucket, 1);
  if (gran === 'week') return addDays(bucket, 7);
  const y = Number(bucket.slice(0, 4));
  const m = Number(bucket.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function computeKpis(repos: Repos, from: string, to: string, teamId?: number): OverviewKpis {
  const people = repos.usage.peopleKpis(from, to, teamId);
  const tokens = repos.usage.tokenCostTotals(from, to, teamId);
  const rostered = repos.users.rosteredUserCount(teamId);
  const events = people.accepted + people.rejected;
  const tokenDenom = tokens.cache_read_tokens + tokens.input_tokens;
  return {
    activeUsers: people.active_users,
    rosteredUsers: rostered,
    adoptionPct: rostered > 0 ? (people.active_rostered / rostered) * 100 : 0,
    sessions: people.sessions,
    linesAdded: people.lines_added,
    linesRemoved: people.lines_removed,
    commits: people.commits,
    pullRequests: people.pull_requests,
    acceptanceRate: events > 0 ? people.accepted / events : null,
    costCents: tokens.cost_cents,
    tokens: {
      input: tokens.input_tokens,
      output: tokens.output_tokens,
      cacheRead: tokens.cache_read_tokens,
      cacheCreation: tokens.cache_creation_tokens,
    },
    cacheRatio: tokenDenom > 0 ? tokens.cache_read_tokens / tokenDenom : null,
  };
}

export function getOverview(repos: Repos, q: OverviewQuery): OverviewResponse {
  const { from, to, teamId } = q;
  const gran = q.gran ?? 'day';
  const rangeDays = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(rangeDays - 1));

  const kpis = computeKpis(repos, from, to, teamId);
  const prevKpis = computeKpis(repos, prevFrom, prevTo, teamId);

  // --- one gap-filled point per bucket (per day when gran='day');
  //     date = bucket start, activeUsers = distinct users within the bucket ---
  const coreByDate = new Map(repos.usage.dailyCore(from, to, teamId, gran).map((r) => [r.date, r]));
  const costByDate = new Map(repos.usage.dailyCost(from, to, teamId, gran).map((r) => [r.date, r.cost_cents]));
  const daily: OverviewDailyPoint[] = [];
  for (let date = bucketStartOf(from, gran); date <= to; date = nextBucketStart(date, gran)) {
    const core = coreByDate.get(date);
    daily.push({
      date,
      sessions: core?.sessions ?? 0,
      activeUsers: core?.active_users ?? 0,
      linesAdded: core?.lines_added ?? 0,
      linesRemoved: core?.lines_removed ?? 0,
      commits: core?.commits ?? 0,
      pullRequests: core?.pull_requests ?? 0,
      costCents: costByDate.get(date) ?? 0,
    });
  }

  const models: ModelUsage[] = repos.usage.modelTotals(from, to, teamId).map((r) => ({
    model: r.model,
    tokens: {
      input: r.input_tokens,
      output: r.output_tokens,
      cacheRead: r.cache_read_tokens,
      cacheCreation: r.cache_creation_tokens,
    },
    costCents: r.cost_cents,
  }));

  const modelDailyCost: ModelDailyCost[] = repos.usage.modelDailyCost(from, to, teamId).map((r) => ({
    date: r.date,
    model: r.model,
    costCents: r.cost_cents,
  }));

  const terminalMix: TerminalMixEntry[] = repos.usage.terminalMix(from, to, { teamId }).map((r) => ({
    terminalType: r.terminal_type,
    sessions: r.sessions,
  }));

  // --- partial dates: today (and today-1 just after local midnight), reported
  //     as the start date of any bucket containing a partial day ---
  const today = todayLocal();
  const partialDays: string[] = [];
  const yesterday = addDays(today, -1);
  if (localHourOfUtc(hourIsoOf(new Date())) < 1 && yesterday >= from && yesterday <= to) {
    partialDays.push(yesterday);
  }
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (date >= today) partialDays.push(date);
  }
  const partialDates = [...new Set(partialDays.map((d) => bucketStartOf(d, gran)))];

  return {
    range: { from, to },
    partialDates,
    kpis,
    prevKpis,
    daily,
    models,
    modelDailyCost,
    terminalMix,
  };
}
