import {
  addDays,
  computeStreaks,
  computeAxes,
  computeBadges,
  computeBaselines,
  segmentFor,
  significantModelCount,
  resolveTargets,
  workdaysBetween,
  utcHourRangeOfLocalDays,
  median,
  TOOL_NAMES,
  type ActorType,
  type Baselines,
  type ImpactCoverage,
  type LeaderboardEntry,
  type ScoreTargets,
  type LeaderboardMetrics,
  type LeaderboardResponse,
  type ScoringInput,
  type ToolName,
  type UserDto,
} from '@dash/shared';
import type { Repos } from '../repos';
import { EMPTY_BADGE_STATS } from '../repos/otelRepo';
import { toUserDto, type UserRow } from '../repos/userRepo';
import { hourInWindow, localHourOfUtc, orgTimezone, streakMode } from '../util/time';

export interface RangeParams {
  from: string;
  to: string;
}

interface HourlyShares {
  night: number;
  early: number;
  total: number;
}

/** Everything computed once per range; routes slice/filter from here. */
export interface LeaderboardData {
  range: RangeParams;
  baselines: Baselines;
  /** fixed scoring targets (defaults merged with settings.scoreTargets) */
  targets: ScoreTargets;
  /** trailing-90d Impact-term coverage (stable org fact; see usageRepo.impactCoverage) */
  coverage: ImpactCoverage;
  /** entries for every actor (any type) with usage rows in range */
  entries: LeaderboardEntry[];
  entryByUserId: Map<number, LeaderboardEntry>;
  inputByUserId: Map<number, ScoringInput>;
  userRows: UserRow[];
  usersById: Map<number, UserRow>;
  orgMedianScores: { adoption: number; impact: number; efficiency: number; trust: number };
  /** sessions in [to-13, to] / [to-27, to-14] per user */
  sessions14ByUserId: Map<number, { last14: number; prior14: number }>;
  /** all-time last active date per user */
  lastActiveByUserId: Map<number, string>;
  /** sessions per day in [to-27, to] per user (trailing window, range-independent) */
  sessionsByDayByUserId: Map<number, Map<string, number>>;
  /** active dates in [to-89, to] per user (trailing window, range-independent) */
  activeDatesByUserId: Map<number, Set<string>>;
  workdays: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

const emptyPerTool = (): Record<ToolName, { accepted: number; rejected: number }> => ({
  edit: { accepted: 0, rejected: 0 },
  multi_edit: { accepted: 0, rejected: 0 },
  write: { accepted: 0, rejected: 0 },
  notebook: { accepted: 0, rejected: 0 },
});

export function buildLeaderboardData(repos: Repos, range: RangeParams): LeaderboardData {
  const { from, to } = range;
  const workdays = workdaysBetween(from, to);

  const userRows = repos.users.listAll();
  const usersById = new Map<number, UserRow>();
  for (const row of userRows) usersById.set(row.id, row);

  const dailyAgg = repos.usage.perUserDaily(from, to);
  const modelAgg = repos.usage.perUserModels(from, to);
  const streakFrom = addDays(to, -89);
  const targets = resolveTargets(repos.settings.getMerged().scoreTargets);
  // Time-of-day badges describe a HABIT, so — like the streaks — they read the
  // trailing 90d rather than the selected range. A 7D range otherwise can't
  // hold the 10 active days the badges require, making them unearnable in
  // that view, and the same person would flip between owl and nothing just by
  // touching the range picker.
  const habitHours = utcHourRangeOfLocalDays(streakFrom, to, orgTimezone());
  const activityRows = repos.otel.hourlyActivity(habitHours.fromHour, habitHours.toHour);
  const hourlyTokenRows = repos.usage.hourlyTokens(streakFrom, to);
  const activeDateRows = repos.usage.activeDates(streakFrom, to);
  const sessionsRows = repos.usage.sessionsByUserDay(addDays(to, -27), to);
  const lastActiveRows = repos.usage.globalLastActiveDates();
  const badgeStatsByUser = repos.otel.perUserBadgeStats(from, to);

  // --- index everything per user ---
  const modelsByUser = new Map<
    number,
    Array<{ model: string; input: number; output: number; cacheRead: number; cacheCreation: number; cost: number }>
  >();
  for (const row of modelAgg) {
    let list = modelsByUser.get(row.user_id);
    if (!list) {
      list = [];
      modelsByUser.set(row.user_id, list);
    }
    list.push({
      model: row.model,
      input: row.input_tokens,
      output: row.output_tokens,
      cacheRead: row.cache_read_tokens,
      cacheCreation: row.cache_creation_tokens,
      cost: row.cost_cents,
    });
  }

  // Prefer real activity events (prompts + API requests); fall back to token
  // volume per user, so an org that syncs usage from the Admin API without
  // OTEL telemetry still gets a share instead of a blank badge.
  const tb = targets.timeBadges;
  const sharesFrom = <T extends { user_id: number; hour_utc: string }>(
    rows: readonly T[],
    weightOf: (row: T) => number,
  ): Map<number, HourlyShares> => {
    const byUser = new Map<number, HourlyShares>();
    for (const row of rows) {
      let agg = byUser.get(row.user_id);
      if (!agg) {
        agg = { night: 0, early: 0, total: 0 };
        byUser.set(row.user_id, agg);
      }
      const h = localHourOfUtc(row.hour_utc);
      const weight = weightOf(row);
      agg.total += weight;
      if (hourInWindow(h, tb.nightStartHour, tb.nightEndHour)) agg.night += weight;
      else if (hourInWindow(h, tb.earlyStartHour, tb.earlyEndHour)) agg.early += weight;
    }
    return byUser;
  };
  const activityByUser = sharesFrom(activityRows, (r) => r.events);
  const tokensByUser = sharesFrom(hourlyTokenRows, (r) => r.tokens);

  const activeDatesByUser = new Map<number, Set<string>>();
  for (const row of activeDateRows) {
    let set = activeDatesByUser.get(row.user_id);
    if (!set) {
      set = new Set();
      activeDatesByUser.set(row.user_id, set);
    }
    set.add(row.date);
  }

  const sessionsByUserDay = new Map<number, Map<string, number>>();
  for (const row of sessionsRows) {
    let map = sessionsByUserDay.get(row.user_id);
    if (!map) {
      map = new Map();
      sessionsByUserDay.set(row.user_id, map);
    }
    map.set(row.date, row.sessions);
  }

  const lastActiveByUserId = new Map<number, string>();
  for (const row of lastActiveRows) lastActiveByUserId.set(row.user_id, row.last_date);

  // --- assemble ScoringInput for every actor with usage in range ---
  const inputByUserId = new Map<number, ScoringInput>();
  const dailyByUser = new Map<number, (typeof dailyAgg)[number]>();
  const usersWithUsage = new Set<number>();
  for (const row of dailyAgg) {
    dailyByUser.set(row.user_id, row);
    usersWithUsage.add(row.user_id);
  }
  for (const userId of modelsByUser.keys()) usersWithUsage.add(userId);

  for (const userId of usersWithUsage) {
    const daily = dailyByUser.get(userId);
    const userActiveDates = activeDatesByUser.get(userId) ?? new Set<string>();
    const userStreaks = computeStreaks(userActiveDates, to, streakMode(), streakFrom);
    const models = modelsByUser.get(userId) ?? [];
    const activity = activityByUser.get(userId);
    const hourly = activity && activity.total > 0 ? activity : tokensByUser.get(userId);
    const modelTokens: Record<string, number> = {};
    let costCents = 0;
    let inputTokens = 0;
    let cacheReadTokens = 0;
    for (const m of models) {
      modelTokens[m.model] = (modelTokens[m.model] ?? 0) + m.input + m.output + m.cacheRead + m.cacheCreation;
      costCents += m.cost;
      inputTokens += m.input;
      cacheReadTokens += m.cacheRead;
    }
    const activeDatesInRange = new Set(
      [...(activeDatesByUser.get(userId) ?? [])].filter((d) => d >= from && d <= to),
    );
    inputByUserId.set(userId, {
      userId,
      sessions: daily?.sessions ?? 0,
      activeDays: daily?.active_days ?? activeDatesInRange.size,
      workdays,
      toolAccepted:
        (daily?.edit_accepted ?? 0) +
        (daily?.multi_edit_accepted ?? 0) +
        (daily?.write_accepted ?? 0) +
        (daily?.notebook_accepted ?? 0),
      toolRejected:
        (daily?.edit_rejected ?? 0) +
        (daily?.multi_edit_rejected ?? 0) +
        (daily?.write_rejected ?? 0) +
        (daily?.notebook_rejected ?? 0),
      linesAdded: daily?.lines_added ?? 0,
      commits: daily?.commits ?? 0,
      pullRequests: daily?.pull_requests ?? 0,
      costCents,
      inputTokens,
      cacheReadTokens,
      modelTokens,
      nightShare: hourly && hourly.total > 0 ? hourly.night / hourly.total : null,
      earlyShare: hourly && hourly.total > 0 ? hourly.early / hourly.total : null,
      habitActiveDays: userActiveDates.size,
      currentStreak: userStreaks.current,
      bestStreak: userStreaks.best,
      ...(badgeStatsByUser.get(userId) ?? EMPTY_BADGE_STATS),
    });
  }

  // --- baselines: UNFILTERED user-actor population with usage in range ---
  const userActorInputs = [...inputByUserId.entries()]
    .filter(([userId]) => usersById.get(userId)?.actor_type === 'user')
    .map(([, input]) => input);
  const baselines = computeBaselines(userActorInputs);
  const covRow = repos.usage.impactCoverage(addDays(to, -89), to);
  const coverage: ImpactCoverage = {
    pullRequests: covRow.activeUsers > 0 ? covRow.usersWithPrs / covRow.activeUsers : 0,
    commits: covRow.activeUsers > 0 ? covRow.usersWithCommits / covRow.activeUsers : 0,
  };

  // --- entries ---
  const entryByUserId = new Map<number, LeaderboardEntry>();
  const entries: LeaderboardEntry[] = [];
  for (const [userId, input] of inputByUserId) {
    const userRow = usersById.get(userId);
    if (!userRow) continue;
    const entry = assembleEntry({
      user: toUserDto(userRow),
      input,
      baselines,
      targets,
      coverage,
      daily: dailyByUser.get(userId),
      models: modelsByUser.get(userId) ?? [],
      activeDates: activeDatesByUser.get(userId) ?? new Set(),
      sessionsByDay: sessionsByUserDay.get(userId) ?? new Map(),
      lastActiveDate: lastActiveByUserId.get(userId) ?? null,
      to,
    });
    entryByUserId.set(userId, entry);
    entries.push(entry);
  }

  // --- org medians over user-actor entries with a composite ---
  const scored = entries.filter(
    (e) => e.user.actorType === 'user' && e.scores.composite !== null,
  );
  const orgMedianScores = {
    adoption: round1(median(scored.map((e) => e.scores.adoption))),
    impact: round1(median(scored.map((e) => e.scores.impact))),
    efficiency: round1(median(scored.map((e) => e.scores.efficiency))),
    trust: round1(median(scored.map((e) => e.scores.trust))),
  };

  const sessions14ByUserId = new Map<number, { last14: number; prior14: number }>();
  const last14From = addDays(to, -13);
  const prior14From = addDays(to, -27);
  const prior14To = addDays(to, -14);
  for (const [userId, byDay] of sessionsByUserDay) {
    let last14 = 0;
    let prior14 = 0;
    for (const [date, sessions] of byDay) {
      if (date >= last14From && date <= to) last14 += sessions;
      else if (date >= prior14From && date <= prior14To) prior14 += sessions;
    }
    sessions14ByUserId.set(userId, { last14, prior14 });
  }

  return {
    range,
    baselines,
    targets,
    coverage,
    entries,
    entryByUserId,
    inputByUserId,
    userRows,
    usersById,
    orgMedianScores,
    sessions14ByUserId,
    lastActiveByUserId,
    sessionsByDayByUserId: sessionsByUserDay,
    activeDatesByUserId: activeDatesByUser,
    workdays,
  };
}

interface EntryParts {
  user: UserDto;
  input: ScoringInput;
  baselines: Baselines;
  targets: ScoreTargets;
  coverage: ImpactCoverage;
  daily:
    | {
        lines_removed: number;
        edit_accepted: number;
        edit_rejected: number;
        multi_edit_accepted: number;
        multi_edit_rejected: number;
        write_accepted: number;
        write_rejected: number;
        notebook_accepted: number;
        notebook_rejected: number;
      }
    | undefined;
  models: Array<{ input: number; output: number; cacheRead: number; cacheCreation: number }>;
  activeDates: Set<string>;
  sessionsByDay: Map<string, number>;
  lastActiveDate: string | null;
  to: string;
}

function assembleEntry(parts: EntryParts): LeaderboardEntry {
  const { user, input, baselines, targets, coverage, daily, models, activeDates, sessionsByDay, lastActiveDate, to } = parts;

  const axes = computeAxes(input, targets, coverage);
  const segment = segmentFor(axes);
  const badges = computeBadges(input, baselines, axes, targets);

  const perTool = emptyPerTool();
  if (daily) {
    perTool.edit = { accepted: daily.edit_accepted, rejected: daily.edit_rejected };
    perTool.multi_edit = { accepted: daily.multi_edit_accepted, rejected: daily.multi_edit_rejected };
    perTool.write = { accepted: daily.write_accepted, rejected: daily.write_rejected };
    perTool.notebook = { accepted: daily.notebook_accepted, rejected: daily.notebook_rejected };
  }

  let output = 0;
  let cacheCreation = 0;
  for (const m of models) {
    output += m.output;
    cacheCreation += m.cacheCreation;
  }

  const toolEvents = input.toolAccepted + input.toolRejected;
  const tokenDenom = input.inputTokens + input.cacheReadTokens;
  const metrics: LeaderboardMetrics = {
    sessions: input.sessions,
    activeDays: input.activeDays,
    workdays: input.workdays,
    linesAdded: input.linesAdded,
    linesRemoved: daily?.lines_removed ?? 0,
    commits: input.commits,
    pullRequests: input.pullRequests,
    toolAccepted: input.toolAccepted,
    toolRejected: input.toolRejected,
    acceptanceRate: toolEvents > 0 ? input.toolAccepted / toolEvents : null,
    perTool,
    costCents: input.costCents,
    tokens: {
      input: input.inputTokens,
      output,
      cacheRead: input.cacheReadTokens,
      cacheCreation,
    },
    cacheRatio: tokenDenom > 0 ? input.cacheReadTokens / tokenDenom : null,
    significantModels: significantModelCount(input.modelTokens),
  };

  // sparkline: sessions/day for the last 14 days of the range, oldest first
  const sparkline: number[] = [];
  for (let i = 13; i >= 0; i--) {
    const date = addDays(to, -i);
    sparkline.push(sessionsByDay.get(date) ?? 0);
  }
  let last14 = 0;
  let prior14 = 0;
  const last14From = addDays(to, -13);
  const prior14From = addDays(to, -27);
  const prior14To = addDays(to, -14);
  for (const [date, sessions] of sessionsByDay) {
    if (date >= last14From && date <= to) last14 += sessions;
    else if (date >= prior14From && date <= prior14To) prior14 += sessions;
  }
  const trendDeltaPct = prior14 > 0 ? round1(((last14 - prior14) / prior14) * 100) : null;

  return {
    user,
    metrics,
    scores: axes,
    segment,
    badges,
    streak: {
      current: input.currentStreak,
      best: computeStreaks(activeDates, to, streakMode(), addDays(to, -89)).best,
    },
    sparkline,
    trendDeltaPct,
    lastActiveDate,
  };
}

/** Entry for a specific user against org baselines — zero metrics when no usage in range. */
export function entryForUser(data: LeaderboardData, userId: number): LeaderboardEntry | undefined {
  const existing = data.entryByUserId.get(userId);
  if (existing) return existing;
  const userRow = data.usersById.get(userId);
  if (!userRow) return undefined;

  // Sparkline/streaks come from range-independent trailing windows, so a user
  // with no usage inside [from, to] must still get their trailing data —
  // matching the semantics used for every in-range user.
  const activeDates = data.activeDatesByUserId.get(userId) ?? new Set<string>();
  const streaks = computeStreaks(activeDates, data.range.to, streakMode(), addDays(data.range.to, -89));
  const sessionsByDay = data.sessionsByDayByUserId.get(userId) ?? new Map<string, number>();

  const zeroInput: ScoringInput = {
    userId,
    sessions: 0,
    activeDays: 0,
    workdays: data.workdays,
    toolAccepted: 0,
    toolRejected: 0,
    linesAdded: 0,
    commits: 0,
    pullRequests: 0,
    costCents: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    modelTokens: {},
    nightShare: null,
    earlyShare: null,
    habitActiveDays: activeDates.size,
    currentStreak: streaks.current,
    bestStreak: streaks.best,
    ...EMPTY_BADGE_STATS,
  };
  return assembleEntry({
    user: toUserDto(userRow),
    input: zeroInput,
    baselines: data.baselines,
    targets: data.targets,
    coverage: data.coverage,
    daily: undefined,
    models: [],
    activeDates,
    sessionsByDay,
    lastActiveDate: data.lastActiveByUserId.get(userId) ?? null,
    to: data.range.to,
  });
}

export function sortEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    const ca = a.scores.composite;
    const cb = b.scores.composite;
    if (ca === null && cb === null) {
      if (b.metrics.sessions !== a.metrics.sessions) return b.metrics.sessions - a.metrics.sessions;
      return a.user.name.localeCompare(b.user.name);
    }
    if (ca === null) return 1;
    if (cb === null) return -1;
    if (cb !== ca) return cb - ca;
    if (b.metrics.sessions !== a.metrics.sessions) return b.metrics.sessions - a.metrics.sessions;
    return a.user.name.localeCompare(b.user.name);
  });
}

export interface LeaderboardQuery extends RangeParams {
  teamId?: number;
  actorType?: ActorType | 'all';
}

export function getLeaderboard(repos: Repos, q: LeaderboardQuery): LeaderboardResponse {
  const data = buildLeaderboardData(repos, { from: q.from, to: q.to });
  const actorType = q.actorType ?? 'user';
  let entries = data.entries.filter((e) => actorType === 'all' || e.user.actorType === actorType);
  if (q.teamId !== undefined) entries = entries.filter((e) => e.user.teamId === q.teamId);
  return {
    range: { from: q.from, to: q.to },
    entries: sortEntries(entries),
    orgMedianScores: data.orgMedianScores,
  };
}
