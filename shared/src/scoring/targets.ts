/**
 * Fixed scoring targets — the reference every volume/ratio metric is scored
 * against. Replaces org-max normalization so one person's volume can never
 * rescale anyone else's score: an axis score is a pure function of the user's
 * own numbers and these constants.
 *
 * Volume targets are rates per workday (Sun–Thu) and scale with the selected
 * range via `workdaysBetween`; ratio targets are flat. Defaults were derived
 * from a real 31-user org's p90 rates (2026-08); admins can override any
 * subset via settings (`scoreTargets`) — unknown/invalid values fall back to
 * these defaults rather than zeroing anyone.
 */

export interface ScoreTargets {
  /** rate per workday; multiplied by max(1, workdays in range) */
  perWorkday: {
    sessions: number;
    toolEvents: number;
    linesAdded: number;
    commits: number;
    pullRequests: number;
  };
  /** range-independent ratios */
  flat: {
    linesPerSession: number;
    linesPerDollar: number;
  };
  /**
   * Night Owl / Early Bird. Windows are org-local hours, `end` exclusive, and
   * may wrap midnight (22 → 5). The two shares are separate on purpose: the
   * night window is 7h wide and the early one 5h, so one bar for both makes
   * the shorter window arithmetically harder to clear.
   *
   * Defaults are calibrated on a real 33-user org (2026-08) whose prompt-hour
   * histogram peaks 10:00–17:00: 12% of all activity lands in the night window
   * and 1.2% before 09:00. An org that genuinely starts at dawn should raise
   * `earlyShare` / narrow `earlyEndHour` via settings.
   */
  timeBadges: {
    /** minimum share (0..1) of windowed activity to earn the badge */
    nightShare: number;
    earlyShare: number;
    /** org-local window bounds; `end` is exclusive */
    nightStartHour: number;
    nightEndHour: number;
    earlyStartHour: number;
    earlyEndHour: number;
    /** distinct active days (trailing 90d) before either badge can be earned */
    minActiveDays: number;
  };
  /**
   * Streak badge thresholds, in active days in a row (trailing 90d). What a
   * given number *costs* depends on the org's `STREAK_MODE`: under `workweek`
   * a run spans days off the person never works, so 5 is one work week; under
   * `calendar` every day counts, so 7 is the first tier a five-day week cannot
   * reach. Defaults suit the work-week rule — an org on calendar days should
   * raise them via settings.
   */
  streaks: {
    bronze: number;
    silver: number;
    gold: number;
    kryptonite: number;
  };
}

export const DEFAULT_SCORE_TARGETS: ScoreTargets = {
  perWorkday: { sessions: 8, toolEvents: 50, linesAdded: 1400, commits: 7.5, pullRequests: 0.5 },
  flat: { linesPerSession: 430, linesPerDollar: 48 },
  timeBadges: {
    nightShare: 0.3,
    earlyShare: 0.15,
    nightStartHour: 22,
    nightEndHour: 5,
    earlyStartHour: 5,
    earlyEndHour: 10,
    minActiveDays: 10,
  },
  streaks: { bronze: 5, silver: 10, gold: 20, kryptonite: 40 },
};

/**
 * Share of active users (sessions > 0) with a nonzero value for each
 * git-derived Impact term, over a trailing-90d window — deliberately NOT the
 * selected range, so Impact weights are a stable org fact instead of flipping
 * with the date picker (a 7-day view has near-zero PR coverage even in a
 * GitHub org).
 */
export interface ImpactCoverage {
  pullRequests: number;
  commits: number;
}

/** Below this coverage a git-derived Impact term redistributes its weight. */
export const COVERAGE_MIN = 0.25;

const positive = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Deep-merge a (possibly partial/malformed) stored override over the
 * defaults. Only finite positive numbers are honored, per key — a bad or
 * partial value degrades to the default instead of breaking scoring.
 */
export function resolveTargets(override?: unknown): ScoreTargets {
  const o = (override ?? {}) as Partial<ScoreTargets>;
  const pick = <T extends Record<string, number>>(base: T, over: Partial<T> | undefined): T => {
    const out: Record<string, number> = { ...base };
    if (over && typeof over === 'object') {
      for (const key of Object.keys(base)) {
        const v = (over as Record<string, unknown>)[key];
        if (positive(v)) out[key] = v;
      }
    }
    return out as T;
  };
  return {
    perWorkday: pick(DEFAULT_SCORE_TARGETS.perWorkday, o.perWorkday),
    flat: pick(DEFAULT_SCORE_TARGETS.flat, o.flat),
    timeBadges: pickTimeBadges(o.timeBadges),
    streaks: pickStreaks(o.streaks),
  };
}

/**
 * Whole days only, and each tier must be at least its predecessor — an
 * out-of-order ladder would silently make a higher badge easier than a lower
 * one. A bad tier degrades to its default rather than breaking the ladder.
 */
function pickStreaks(over: unknown): ScoreTargets['streaks'] {
  const base = DEFAULT_SCORE_TARGETS.streaks;
  const out = { ...base };
  if (over && typeof over === 'object') {
    const o = over as Record<string, unknown>;
    for (const key of ['bronze', 'silver', 'gold', 'kryptonite'] as const) {
      const v = o[key];
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) out[key] = v;
    }
  }
  return out.bronze <= out.silver && out.silver <= out.gold && out.gold <= out.kryptonite
    ? out
    : { ...base };
}

const share = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 1;
const hour = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;

/**
 * Hours legitimately include 0, and shares are capped at 1, so the shared
 * `positive()` pick would both reject midnight and accept a 300% threshold —
 * this group validates per key against its own domain.
 */
function pickTimeBadges(over: unknown): ScoreTargets['timeBadges'] {
  const base = DEFAULT_SCORE_TARGETS.timeBadges;
  const out = { ...base };
  if (!over || typeof over !== 'object') return out;
  const o = over as Record<string, unknown>;
  if (share(o['nightShare'])) out.nightShare = o['nightShare'];
  if (share(o['earlyShare'])) out.earlyShare = o['earlyShare'];
  if (hour(o['nightStartHour'])) out.nightStartHour = o['nightStartHour'];
  if (hour(o['nightEndHour'])) out.nightEndHour = o['nightEndHour'];
  if (hour(o['earlyStartHour'])) out.earlyStartHour = o['earlyStartHour'];
  if (hour(o['earlyEndHour'])) out.earlyEndHour = o['earlyEndHour'];
  const days = o['minActiveDays'];
  if (typeof days === 'number' && Number.isInteger(days) && days > 0) out.minActiveDays = days;
  return out;
}
