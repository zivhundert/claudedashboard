import { describe, expect, it } from 'vitest';
import { score, percentile } from '../src/scoring/normalize.js';
import {
  COVERAGE_MIN,
  DEFAULT_SCORE_TARGETS,
  resolveTargets,
} from '../src/scoring/targets.js';
import {
  GUARDS,
  computeAxes,
  computeBaselines,
  segmentFor,
  significantModelCount,
  type ScoringInput,
} from '../src/scoring/scores.js';
import { computeBadges } from '../src/scoring/badges.js';
import {
  addDays,
  bestDailyStreak,
  bestWorkweekStreak,
  computeStreaks,
  currentDailyStreak,
  currentWorkweekStreak,
  expectedWeekdays,
  localDateOf,
  utcHourRangeOfLocalDays,
  isWorkday,
  workdaysBetween,
} from '../src/time/workweek.js';

function makeInput(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    userId: 1,
    sessions: 40,
    activeDays: 15,
    workdays: 22,
    toolAccepted: 80,
    toolRejected: 20,
    linesAdded: 5000,
    commits: 20,
    pullRequests: 6,
    costCents: 10_000,
    inputTokens: 1_000_000,
    cacheReadTokens: 3_000_000,
    modelTokens: { 'claude-fable-5': 3_500_000, 'claude-haiku-4-5': 500_000 },
    nightShare: 0.05,
    earlyShare: 0.1,
    habitActiveDays: 15,
    currentStreak: 6,
    bestStreak: 6,
    skillInvocations: 25,
    distinctSkills: 6,
    mcpCalls: 200,
    mcpFailures: 10,
    activeMcpServers: 4,
    subagentRuns: 30,
    subagentSuccesses: 29,
    distinctAgentTypes: 3,
    planModeEntries: 12,
    plansAccepted: 6,
    compactions: 30,
    ...overrides,
  };
}

describe('score (fixed-target sqrt)', () => {
  it('is 0 at zero and 100 at the target', () => {
    expect(score(0, 100)).toBe(0);
    expect(score(100, 100)).toBe(100);
  });
  it('caps past the target — inflation does not pay', () => {
    expect(score(500, 100)).toBe(100);
    expect(score(1_000_000, 100)).toBe(100);
  });
  it('handles a zero target without NaN', () => {
    expect(score(10, 0)).toBe(0);
  });
  it('grades every metric on the same curve: half the target = 70.7', () => {
    expect(score(50, 100)).toBeCloseTo(70.7, 1);
    expect(score(700, 1400)).toBeCloseTo(70.7, 1);
  });
  it('locks the curve to exact values', () => {
    expect(score(40, 168)).toBeCloseTo(48.795, 3);
    expect(score(84, 168)).toBeCloseTo(70.711, 3);
    expect(Number.isFinite(score(1, Number.MAX_SAFE_INTEGER))).toBe(true);
  });
});

describe('resolveTargets', () => {
  it('returns defaults with no override', () => {
    expect(resolveTargets()).toEqual(DEFAULT_SCORE_TARGETS);
    expect(resolveTargets(null)).toEqual(DEFAULT_SCORE_TARGETS);
  });
  it('merges a partial override over defaults', () => {
    const t = resolveTargets({ perWorkday: { sessions: 12 } });
    expect(t.perWorkday.sessions).toBe(12);
    expect(t.perWorkday.commits).toBe(DEFAULT_SCORE_TARGETS.perWorkday.commits);
    expect(t.flat).toEqual(DEFAULT_SCORE_TARGETS.flat);
  });
  it('ignores malformed values instead of breaking scoring', () => {
    const t = resolveTargets({
      perWorkday: { sessions: -5, linesAdded: 'lots', commits: 0 },
      flat: 'nope',
    });
    expect(t).toEqual(DEFAULT_SCORE_TARGETS);
  });
  it('accepts midnight as a window bound but rejects impossible shares', () => {
    const t = resolveTargets({
      timeBadges: { nightStartHour: 0, earlyShare: 3, nightShare: 0.25, minActiveDays: 2.5 },
    });
    expect(t.timeBadges.nightStartHour).toBe(0); // hour 0 is legal, not "falsy"
    expect(t.timeBadges.nightShare).toBe(0.25);
    expect(t.timeBadges.earlyShare).toBe(DEFAULT_SCORE_TARGETS.timeBadges.earlyShare); // >1
    expect(t.timeBadges.minActiveDays).toBe(DEFAULT_SCORE_TARGETS.timeBadges.minActiveDays); // non-int
  });
  it('fills the whole timeBadges group for targets stored before it existed', () => {
    const legacy = { perWorkday: { sessions: 9 }, flat: { linesPerSession: 400 } };
    expect(resolveTargets(legacy).timeBadges).toEqual(DEFAULT_SCORE_TARGETS.timeBadges);
  });
});

describe('percentile', () => {
  it('interpolates linearly', () => {
    expect(percentile([0, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 80)).toBeCloseTo(4.2);
  });
  it('handles empty and single-value samples', () => {
    expect(percentile([], 80)).toBe(0);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe('workweek + daily streaks', () => {
  it('buckets days in org-local time, not UTC', () => {
    // 2026-07-28 22:30 UTC = 2026-07-29 01:30 in Jerusalem (UTC+3) — late-night
    // work belongs to the NEW day, or the new day looks empty and streaks break.
    expect(localDateOf('2026-07-28T22:30:00Z')).toBe('2026-07-29');
    expect(localDateOf('2026-07-28T20:59:00Z')).toBe('2026-07-28');
    // winter: UTC+2
    expect(localDateOf('2026-01-14T22:30:00Z')).toBe('2026-01-15');
    expect(localDateOf('2026-01-14T21:30:00Z')).toBe('2026-01-14');
    // zero-padded, always YYYY-MM-DD — this string becomes a database key, so
    // it must never inherit a locale's date pattern
    expect(localDateOf('2026-01-02T12:00:00Z')).toBe('2026-01-02');
    expect(localDateOf('2026-01-02T12:00:00Z', 'UTC')).toBe('2026-01-02');
    expect(localDateOf('2026-01-02T00:30:00Z', 'UTC')).toBe('2026-01-02');
    expect(localDateOf('2026-01-02T00:30:00Z', 'America/New_York')).toBe('2026-01-01');
    expect(() => localDateOf('not-a-date')).toThrow(RangeError);
  });

  it('converts a local-day range into the UTC hours that actually cover it', () => {
    // hour tables are UTC; pasting 'T00:00:00Z' onto a local date would drop the
    // range's first 3 local hours and leak 3 from the day after `to`
    expect(utcHourRangeOfLocalDays('2026-07-05', '2026-07-11')).toEqual({
      fromHour: '2026-07-04T21:00:00Z', // 00:00 Sun in Jerusalem, UTC+3
      toHour: '2026-07-11T20:00:00Z', // 23:00 Sat in Jerusalem
    });
    // winter is UTC+2
    expect(utcHourRangeOfLocalDays('2026-01-04', '2026-01-10')).toEqual({
      fromHour: '2026-01-03T22:00:00Z',
      toHour: '2026-01-10T21:00:00Z',
    });
    // a range that straddles the DST switch gets each end in its own offset
    expect(utcHourRangeOfLocalDays('2026-03-25', '2026-04-01')).toEqual({
      fromHour: '2026-03-24T22:00:00Z',
      toHour: '2026-04-01T20:00:00Z',
    });
    expect(utcHourRangeOfLocalDays('2026-07-05', '2026-07-11', 'UTC')).toEqual({
      fromHour: '2026-07-05T00:00:00Z',
      toHour: '2026-07-11T23:00:00Z',
    });
  });
  it('classifies weekdays: Fri/Sat are weekend', () => {
    expect(isWorkday('2026-07-05')).toBe(true); // Sunday
    expect(isWorkday('2026-07-09')).toBe(true); // Thursday
    expect(isWorkday('2026-07-10')).toBe(false); // Friday
    expect(isWorkday('2026-07-11')).toBe(false); // Saturday
  });
  it('counts workdays in a range', () => {
    // Sun 2026-07-05 .. Sat 2026-07-11 = Sun,Mon,Tue,Wed,Thu = 5
    expect(workdaysBetween('2026-07-05', '2026-07-11')).toBe(5);
  });
  it('breaks on ANY missed calendar day, weekend included', () => {
    // active every workday Sun–Thu, idle Fri+Sat, active again Sun
    const active = new Set([
      '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-12',
    ]);
    // the Sun–Thu run was 5 long, but the weekend ended it: today stands alone
    expect(currentDailyStreak(active, '2026-07-12')).toBe(1);
    expect(bestDailyStreak(active)).toBe(5);
  });

  it('counts consecutive calendar days, weekends included when worked', () => {
    const active = new Set([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25',
    ]);
    expect(currentDailyStreak(active, '2026-07-25')).toBe(6);
    expect(bestDailyStreak(active)).toBe(6);
  });

  it('grants grace for asOf itself (today not over yet)', () => {
    const active = new Set(['2026-07-07', '2026-07-08']);
    expect(currentDailyStreak(active, '2026-07-09')).toBe(2);
  });

  it('grace is one day only', () => {
    // both asOf and the day before are idle — the run is over
    const active = new Set(['2026-07-06', '2026-07-07']);
    expect(currentDailyStreak(active, '2026-07-09')).toBe(0);
  });

  it('grace does not bridge an older gap', () => {
    // asOf active, day before missing → streak 1, not resumed further back
    const active = new Set(['2026-07-06', '2026-07-09']);
    expect(currentDailyStreak(active, '2026-07-09')).toBe(1);
  });

  it('best streak is the longest consecutive run anywhere', () => {
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-12', '2026-07-13']);
    expect(bestDailyStreak(active)).toBe(2);
  });

  it('current never exceeds best', () => {
    const active = new Set(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-25', '2026-07-26']);
    const current = currentDailyStreak(active, '2026-07-26');
    const best = bestDailyStreak(active);
    expect(current).toBe(2);
    expect(best).toBe(3);
    expect(current).toBeLessThanOrEqual(best);
  });

  it('no activity is no streak', () => {
    expect(currentDailyStreak(new Set(), '2026-07-26')).toBe(0);
    expect(bestDailyStreak(new Set())).toBe(0);
  });

  it('a sparse worker accumulates no streak (the inflated-badge regression)', () => {
    // shape taken from a real inflated case: three workdays missed mid-run,
    // then a weekend gap — the learned-work-week version scored this run 23
    const active = new Set([
      '2026-08-02', '2026-08-06', '2026-08-09', '2026-08-10', '2026-08-11',
      '2026-08-12', '2026-08-13', '2026-08-16',
    ]);
    expect(currentDailyStreak(active, '2026-08-16')).toBe(1);
    expect(bestDailyStreak(active)).toBe(5); // 08-09 .. 08-13
  });
});

describe('workweek streaks (the other mode)', () => {
  it('streak survives the Fri/Sat weekend', () => {
    // active Wed, Thu, then Sun — Fri/Sat skipped
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-12']);
    expect(currentWorkweekStreak(active, '2026-07-12')).toBe(3);
  });
  it('streak breaks on a missed workday', () => {
    // active Wed, Thu, missed Sun, active Mon
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-13']);
    expect(currentWorkweekStreak(active, '2026-07-13')).toBe(1);
  });
  it('grants grace for asOf itself (today not yet active)', () => {
    const active = new Set(['2026-07-07', '2026-07-08']);
    expect(currentWorkweekStreak(active, '2026-07-09')).toBe(2);
  });
  it('grace does not bridge an older gap', () => {
    // asOf active, day before missing → streak 1, not resumed further back
    const active = new Set(['2026-07-06', '2026-07-09']);
    expect(currentWorkweekStreak(active, '2026-07-09')).toBe(1);
  });
  it('best streak spans weekends too', () => {
    const active = new Set(['2026-07-08', '2026-07-09', '2026-07-12', '2026-07-13']);
    expect(bestWorkweekStreak(active)).toBe(4);
  });
  it('learns each person\'s work week instead of assuming one', () => {
    // Jul 2026: 1st is a Wednesday. A US schedule: every Mon-Fri, never a weekend.
    const usDates = new Set<string>();
    for (const d of ['06', '07', '08', '09', '10', '13', '14', '15', '16', '17', '20', '21', '22', '23', '24']) {
      usDates.add(`2026-07-${d}`); // Mon-Fri x3 weeks
    }
    const us = expectedWeekdays(usDates, '2026-07-06', '2026-07-24');
    expect([...us].sort()).toEqual([1, 2, 3, 4, 5]); // Mon-Fri, no Sunday
    // ...so their idle Sunday does not break the streak, which the Sun-Thu
    // assumption did on every single week
    expect(currentWorkweekStreak(usDates, '2026-07-24', us)).toBe(15);

    // An Israeli schedule over the same window: every Sun-Thu.
    const ilDates = new Set<string>();
    for (const d of ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16', '19', '20', '21', '22', '23']) {
      ilDates.add(`2026-07-${d}`);
    }
    const il = expectedWeekdays(ilDates, '2026-07-05', '2026-07-23');
    expect([...il].sort()).toEqual([0, 1, 2, 3, 4]); // Sun-Thu
    expect(currentWorkweekStreak(ilDates, '2026-07-23', il)).toBe(15);

    // Someone who works most Saturdays: Saturday is one of their work days, so
    // it counts when worked — and an idle one does break the run.
    const sixDay = new Set(
      ['04', '05', '06', '07', '08', '09', '11', '12', '13', '14', '15', '16', '18', '19', '20', '21', '22', '23', '25'].map(
        (d) => `2026-07-${d}`,
      ),
    );
    expect(expectedWeekdays(sixDay, '2026-07-04', '2026-07-25').has(6)).toBe(true);
    expect(expectedWeekdays(sixDay, '2026-07-04', '2026-07-25').has(5)).toBe(false); // never a Friday
  });

  it('never bridges more than a week away', () => {
    const active = new Set(['2026-07-06', '2026-07-20']);
    // an explicitly empty expected set (no longer reachable via expectedWeekdays)
    expect(bestWorkweekStreak(active, new Set())).toBe(1);
    expect(currentWorkweekStreak(active, '2026-07-20', new Set())).toBe(1);
  });

  it('current and best enforce the SAME bridge cap', () => {
    // with no expected weekdays nothing but the cap limits the walk, so this is
    // where the two implementations drift apart if they disagree by one day
    const none = new Set<number>();
    const start = '2026-07-01';
    for (const gap of [1, 2, 6, 7, 8, 9, 14]) {
      const end = addDays(start, gap);
      const active = new Set([start, end]);
      const current = currentWorkweekStreak(active, end, none);
      const best = bestWorkweekStreak(active, none);
      expect(current, `gap of ${gap} days`).toBe(best);
      // a gap of N days holds N-1 idle days; 6 idle bridge, 7 do not
      expect(current, `gap of ${gap} days`).toBe(gap <= 7 ? 2 : 1);
    }
  });

  it('falls back to Sun-Thu only when there is no history', () => {
    expect([...expectedWeekdays(new Set(), '2026-07-05', '2026-07-11')].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('an active Fri/Sat counts as a streak day', () => {
    // Mon..Sat active, asOf Sat — the weekend was worked, so it counts
    const active = new Set([
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25',
    ]);
    expect(currentWorkweekStreak(active, '2026-07-25')).toBe(6);
    expect(bestWorkweekStreak(active)).toBe(6);
    // ...and an idle Sunday after it still breaks the current run
    active.add('2026-07-27');
    expect(currentWorkweekStreak(active, '2026-07-27')).toBe(1);
    expect(bestWorkweekStreak(active)).toBe(6);
  });

  it('learner: an empty result degrades to the fallback, never to "nothing expected"', () => {
    // One Monday and one Tuesday across four weeks: no weekday clears the 50%
    // bar even counted from the first active day, so the learned set comes back
    // empty. Returning it would make every idle day bridgeable — the run below
    // would read 2 instead of 1.
    const sparse = new Set(['2026-07-06', '2026-07-14']);
    const learned = expectedWeekdays(sparse, '2026-05-01', '2026-07-31');
    expect([...learned].sort()).toEqual([0, 1, 2, 3, 4]); // Sun–Thu fallback
    expect(currentWorkweekStreak(sparse, '2026-07-14', learned)).toBe(1);
  });

  it('learner: counts weekdays only from the first active day', () => {
    // Someone onboarded 2026-07-06 who then works every Mon–Fri. Measured over a
    // window that starts in May, every weekday sits below the bar and the whole
    // org reads as having no work week; measured from their first active day,
    // Mon–Fri is obvious.
    const dates = new Set<string>();
    for (const d of ['06', '07', '08', '09', '10', '13', '14', '15', '16', '17', '20', '21', '22', '23', '24']) {
      dates.add(`2026-07-${d}`);
    }
    expect([...expectedWeekdays(dates, '2026-05-01', '2026-07-24')].sort()).toEqual([1, 2, 3, 4, 5]);
    // ...and the run survives their Sundays, which the diluted version could not
    expect(currentWorkweekStreak(dates, '2026-07-24', expectedWeekdays(dates, '2026-05-01', '2026-07-24'))).toBe(15);
  });

  it('computeStreaks dispatches on mode over the same dates', () => {
    // Sun–Thu twice over, weekends off
    const dates = new Set([
      '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
      '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16',
    ]);
    expect(computeStreaks(dates, '2026-07-16', 'workweek', '2026-07-05')).toEqual({ current: 10, best: 10 });
    // the same history under calendar days: each week stands alone
    expect(computeStreaks(dates, '2026-07-16', 'calendar')).toEqual({ current: 5, best: 5 });
  });
});

describe('baselines (badges only)', () => {
  it('excludes zero-usage users from the population', () => {
    const b = computeBaselines([
      makeInput({ sessions: 0, linesAdded: 999_999 }),
      makeInput({ sessions: 10, linesAdded: 100 }),
    ]);
    expect(b.sampleSize).toBe(1);
    expect(b.p80LinesAdded).toBe(100);
  });
});

const TARGETS = DEFAULT_SCORE_TARGETS;
const FULL_COVERAGE = { pullRequests: 1, commits: 1 };

describe('axis scores and guards', () => {
  const population = [
    makeInput({ userId: 1 }),
    makeInput({ userId: 2, sessions: 80, linesAdded: 20_000, commits: 60, pullRequests: 15 }),
    makeInput({ userId: 3, sessions: 5, linesAdded: 200, commits: 1, pullRequests: 0, activeDays: 4 }),
  ];

  it('scores are within 0..100', () => {
    for (const input of population) {
      const axes = computeAxes(input, TARGETS, FULL_COVERAGE);
      for (const v of [axes.adoption, axes.impact, axes.efficiency, axes.trust]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('trust is halved below the tool-event guard', () => {
    const confident = computeAxes(makeInput({ toolAccepted: 60, toolRejected: 40 }), TARGETS, FULL_COVERAGE);
    const sparse = computeAxes(makeInput({ toolAccepted: 6, toolRejected: 4 }), TARGETS, FULL_COVERAGE);
    // identical 60% rate, sparse has < 20 events
    expect(sparse.trustLowConfidence).toBe(true);
    expect(sparse.trust).toBeCloseTo(confident.trust / 2, 0);
  });

  it('efficiency is halved below the session guard', () => {
    const sparse = computeAxes(makeInput({ sessions: 5 }), TARGETS, FULL_COVERAGE);
    expect(sparse.efficiencyLowConfidence).toBe(true);
  });

  it('composite is withheld under 3 active days', () => {
    const axes = computeAxes(makeInput({ activeDays: 2 }), TARGETS, FULL_COVERAGE);
    expect(axes.composite).toBeNull();
  });

  it('trust treats 60% acceptance as perfect', () => {
    const axes = computeAxes(makeInput({ toolAccepted: 60, toolRejected: 40 }), TARGETS, FULL_COVERAGE);
    expect(axes.trust).toBe(100);
  });

  it('locks the axes to exact values for a known input (no population term exists)', () => {
    // hand-computed from DEFAULT_SCORE_TARGETS for makeInput()'s 22-workday
    // fixture — population independence is structural (computeAxes takes no
    // population input), so what needs locking is the formula itself
    const axes = computeAxes(makeInput(), TARGETS, FULL_COVERAGE);
    expect(axes.adoption).toBeCloseTo(52.4, 1);
    expect(axes.impact).toBeCloseTo(48.7, 1);
    expect(axes.efficiency).toBeCloseTo(78.9, 1);
    expect(axes.trust).toBe(100);
  });

  it('scales volume targets by the workdays in range', () => {
    // same per-workday rate over 5 vs 20 workdays -> identical adoption
    const week = computeAxes(makeInput({ sessions: 40, workdays: 5, activeDays: 5, toolAccepted: 250, toolRejected: 0 }), TARGETS, FULL_COVERAGE);
    const month = computeAxes(makeInput({ sessions: 160, workdays: 20, activeDays: 20, toolAccepted: 1000, toolRejected: 0 }), TARGETS, FULL_COVERAGE);
    expect(week.adoption).toBeCloseTo(month.adoption, 1);
  });

  it('guards a zero-workday (weekend-only) range instead of zeroing scores', () => {
    const axes = computeAxes(makeInput({ workdays: 0, activeDays: 2 }), TARGETS, FULL_COVERAGE);
    // volume terms score against max(1, workdays); nothing NaNs or zeroes out
    expect(axes.impact).toBeGreaterThan(0);
    expect(Number.isFinite(axes.adoption)).toBe(true);
  });
});

describe('coverage-gated Impact weights', () => {
  const strong = makeInput({
    userId: 2,
    workdays: 21,
    sessions: 200,
    linesAdded: 30_000,
    commits: 160,
    pullRequests: 0,
    activeDays: 21,
  });

  it('redistributes the PR weight below COVERAGE_MIN (e.g. a Bitbucket org)', () => {
    const low = computeAxes(strong, TARGETS, { pullRequests: 0.16, commits: 0.61 });
    // 4/7 lines + 3/7 commits, both at/above target -> full impact, no PR penalty
    expect(low.impact).toBe(100);
    // with the PR term kept, the same user is penalized for the zero
    const kept = computeAxes(strong, TARGETS, FULL_COVERAGE);
    expect(kept.impact).toBeLessThan(100);
  });

  it('keeps the PR term at/above COVERAGE_MIN', () => {
    // 3 PRs over 21 workdays is well under the 0.5/wd target, so the kept
    // term drags Impact below the redistributed variant — the gate must matter
    const withPrs = makeInput({ ...strong, pullRequests: 3 });
    const at = computeAxes(withPrs, TARGETS, { pullRequests: COVERAGE_MIN, commits: 1 });
    const below = computeAxes(withPrs, TARGETS, { pullRequests: COVERAGE_MIN - 0.01, commits: 1 });
    expect(at.impact).toBeLessThan(below.impact);
  });

  it('falls back to lines-only when both git terms lack coverage', () => {
    const axes = computeAxes(strong, TARGETS, { pullRequests: 0, commits: 0 });
    expect(axes.impact).toBe(100); // lines at target carries the whole axis
  });

  it('keeps Champion attainable without PRs', () => {
    const axes = computeAxes(strong, TARGETS, { pullRequests: 0.1, commits: 0.61 });
    expect(segmentFor(axes)).toBe('champion');
  });

  it('marks PR Machine not-applicable instead of unearnable', () => {
    const noPrOrg = [makeInput({ pullRequests: 0 }), makeInput({ userId: 2, pullRequests: 0 })];
    const b = computeBaselines(noPrOrg);
    const axes = computeAxes(noPrOrg[0]!, TARGETS, { pullRequests: 0, commits: 1 });
    const badge = computeBadges(noPrOrg[0]!, b, axes, TARGETS).find((x) => x.id === 'pr_machine')!;
    expect(badge.earned).toBe(false);
    expect(badge.progress).toBe(0);
    expect(badge.detail).toMatch(/not applicable/i);
  });
});

describe('segments', () => {
  it('maps the four tiers by adoption x impact (champion at 80/80)', () => {
    expect(segmentFor({ adoption: 80, impact: 80 })).toBe('champion');
    expect(segmentFor({ adoption: 75, impact: 80 })).toBe('producer'); // was champion at 70/70
    expect(segmentFor({ adoption: 55, impact: 45 })).toBe('producer');
    expect(segmentFor({ adoption: 10, impact: 5 })).toBe('starter');
    expect(segmentFor({ adoption: 30, impact: 90 })).toBe('explorer');
  });
  it('champion requires BOTH axes', () => {
    expect(segmentFor({ adoption: 90, impact: 79 })).toBe('producer');
  });
});

describe('badges', () => {
  const population = [
    makeInput({ userId: 1 }),
    makeInput({ userId: 2, sessions: 80, linesAdded: 20_000, commits: 60, pullRequests: 15 }),
    makeInput({ userId: 3, sessions: 12, linesAdded: 300, commits: 2, pullRequests: 0 }),
  ];
  const baselines = computeBaselines(population);

  function badgesFor(input: ScoringInput, targets = TARGETS) {
    const axes = computeAxes(input, targets, FULL_COVERAGE);
    return new Map(computeBadges(input, baselines, axes, targets).map((b) => [b.id, b]));
  }

  it('cache master needs ratio AND volume', () => {
    const highRatioLowVolume = badgesFor(
      makeInput({ inputTokens: 100, cacheReadTokens: 900 }),
    ).get('cache_master')!;
    expect(highRatioLowVolume.earned).toBe(false);
    const both = badgesFor(
      makeInput({ inputTokens: 500_000, cacheReadTokens: 2_000_000 }),
    ).get('cache_master')!;
    expect(both.earned).toBe(true);
  });

  it('night owl and early bird are mutually exclusive', () => {
    const map = badgesFor(makeInput({ nightShare: 0.45, earlyShare: 0.35, habitActiveDays: 15 }));
    expect(map.get('night_owl')!.earned).toBe(true);
    expect(map.get('early_bird')!.earned).toBe(false);
  });

  it('time badges require 10 active days', () => {
    const map = badgesFor(makeInput({ nightShare: 0.5, habitActiveDays: 5 }));
    expect(map.get('night_owl')!.earned).toBe(false);
  });

  it('early bird clears its own lower bar', () => {
    // 18% of activity before 10:00 earns Early Bird (bar 15%) even though the
    // same share would be nowhere near Night Owl's 30%.
    const map = badgesFor(makeInput({ nightShare: 0, earlyShare: 0.18, habitActiveDays: 12 }));
    expect(map.get('early_bird')!.earned).toBe(true);
    expect(map.get('night_owl')!.earned).toBe(false);
  });

  it('a qualifying share is never blocked by a sub-threshold one', () => {
    // night 20% misses its 30% bar; early 16% clears its 15% one. The old raw
    // `night >= early` tie-break vetoed early here and awarded nothing.
    const map = badgesFor(makeInput({ nightShare: 0.2, earlyShare: 0.16, habitActiveDays: 12 }));
    expect(map.get('early_bird')!.earned).toBe(true);
    expect(map.get('night_owl')!.earned).toBe(false);
  });

  it('the active-days gate is folded into progress, never contradicting the caption', () => {
    // A real 14% night share with only 7 active days used to show a 0% bar
    // next to a "14% of activity" caption. Progress is now the binding
    // constraint of the two, and the share is what binds here (0.14/0.30).
    const map = badgesFor(makeInput({ nightShare: 0.14, earlyShare: 0, habitActiveDays: 7 }));
    const owl = map.get('night_owl')!;
    expect(owl.earned).toBe(false);
    expect(owl.progress).toBeCloseTo(0.14 / 0.3);
    expect(owl.detail).toContain('14%');
  });

  it('the active-days gate binds progress when it is the weaker term', () => {
    // Share already clears 30%, but 3 active days is a third of the way to
    // eligible — the bar must show that, not a full one.
    const map = badgesFor(makeInput({ nightShare: 0.5, earlyShare: 0, habitActiveDays: 3 }));
    const owl = map.get('night_owl')!;
    expect(owl.earned).toBe(false);
    expect(owl.progress).toBeCloseTo(0.3);
  });

  it('time badge captions name the configured window', () => {
    const map = badgesFor(makeInput());
    expect(map.get('early_bird')!.detail).toContain('05:00–10:00');
    expect(map.get('night_owl')!.detail).toContain('22:00–05:00');
  });

  it('honours org-configured windows and shares', () => {
    const targets = resolveTargets({
      timeBadges: { earlyShare: 0.4, earlyEndHour: 9 },
    });
    const map = badgesFor(makeInput({ earlyShare: 0.18, habitActiveDays: 12 }), targets);
    expect(map.get('early_bird')!.earned).toBe(false);
    expect(map.get('early_bird')!.detail).toContain('05:00–09:00');
  });

  it('experimenting is not applicable once impact arrives', () => {
    const champion = badgesFor(makeInput({ linesAdded: 40_000, commits: 90, pullRequests: 30 }));
    const badge = champion.get('experimenting')!;
    expect(badge.earned).toBe(false);
    expect(badge.detail).toMatch(/not applicable/i);
  });

  it('experimenting still lights up for a real explorer', () => {
    const explorer = badgesFor(
      makeInput({ sessions: 90, toolAccepted: 400, toolRejected: 20, linesAdded: 0, commits: 0, pullRequests: 0 }),
    );
    const badge = explorer.get('experimenting')!;
    expect(badge.earned).toBe(true);
    // the caption is one string for both states, so it must not read as a
    // shortfall ("… / 60 needed") once the badge is actually earned
    expect(badge.detail).toMatch(/^adoption [\d.]+ \/ 60$/);
  });

  it('keeps a streak badge earned after the run breaks', () => {
    const map = badgesFor(makeInput({ currentStreak: 1, bestStreak: 6 }));
    expect(map.get('streak_bronze')!.earned).toBe(true);
    expect(map.get('streak_silver')!.earned).toBe(false);
  });
  it('streak tiers default to 5/10/20/40', () => {
    const map = badgesFor(makeInput({ currentStreak: 11 }));
    expect(map.get('streak_bronze')!.earned).toBe(true);
    expect(map.get('streak_silver')!.earned).toBe(true);
    expect(map.get('streak_gold')!.earned).toBe(false);
    expect(map.get('streak_gold')!.progress).toBeCloseTo(0.55);
    expect(map.get('streak_kryptonite')!.progress).toBeCloseTo(0.275);
    const workaholic = badgesFor(makeInput({ currentStreak: 40, bestStreak: 40 }));
    expect(workaholic.get('streak_kryptonite')!.earned).toBe(true);
    expect(badgesFor(makeInput({ currentStreak: 39, bestStreak: 39 })).get('streak_kryptonite')!.earned).toBe(false);
  });
  it('streak tiers come from scoreTargets, not a constant', () => {
    // a calendar-mode org raises the ladder: a five-day week no longer earns
    const raised = resolveTargets({ streaks: { bronze: 7, silver: 14, gold: 30, kryptonite: 40 } });
    const week = badgesFor(makeInput({ currentStreak: 5, bestStreak: 5 }), raised);
    expect(week.get('streak_bronze')!.earned).toBe(false);
    expect(week.get('streak_bronze')!.progress).toBeCloseTo(5 / 7);
    expect(week.get('streak_bronze')!.detail).toBe('5 / 7 days');
    expect(badgesFor(makeInput({ currentStreak: 7, bestStreak: 7 }), raised).get('streak_bronze')!.earned).toBe(true);
  });
  it('an out-of-order streak ladder degrades to the defaults', () => {
    // gold below silver would make the higher badge easier than the lower one
    expect(resolveTargets({ streaks: { bronze: 7, silver: 14, gold: 3, kryptonite: 40 } }).streaks).toEqual(
      DEFAULT_SCORE_TARGETS.streaks,
    );
  });

  it('polyglot needs 3 models at >=5% share', () => {
    expect(significantModelCount({ a: 50, b: 30, c: 20 })).toBe(3);
    expect(significantModelCount({ a: 96, b: 2, c: 2 })).toBe(1);
    const map = badgesFor(makeInput({ modelTokens: { a: 50, b: 30, c: 20 } }));
    expect(map.get('polyglot')!.earned).toBe(true);
  });

  it('high acceptance follows the reference rule (40% over 20 events)', () => {
    const yes = badgesFor(makeInput({ toolAccepted: 10, toolRejected: 10 }));
    expect(yes.get('high_acceptance')!.earned).toBe(true);
    const tooFew = badgesFor(makeInput({ toolAccepted: 9, toolRejected: 1 }));
    expect(tooFew.get('high_acceptance')!.earned).toBe(false);
  });

  it('skill_smith needs breadth AND volume', () => {
    expect(badgesFor(makeInput({ distinctSkills: 4, skillInvocations: 50 })).get('skill_smith')!.earned).toBe(false);
    expect(badgesFor(makeInput({ distinctSkills: 5, skillInvocations: 20 })).get('skill_smith')!.earned).toBe(true);
  });

  it('plan_first earns at 10 entries with linear progress below', () => {
    expect(badgesFor(makeInput({ planModeEntries: 10 })).get('plan_first')!.earned).toBe(true);
    const below = badgesFor(makeInput({ planModeEntries: 9 })).get('plan_first')!;
    expect(below.earned).toBe(false);
    expect(below.progress).toBeCloseTo(0.9);
  });

  it('dream_builder needs approved plans AND commits', () => {
    expect(badgesFor(makeInput({ plansAccepted: 5, commits: 14 })).get('dream_builder')!.earned).toBe(false);
    expect(badgesFor(makeInput({ plansAccepted: 4, commits: 30 })).get('dream_builder')!.earned).toBe(false);
    expect(badgesFor(makeInput({ plansAccepted: 5, commits: 15 })).get('dream_builder')!.earned).toBe(true);
  });

  it('well_connected enforces the success-rate gate', () => {
    expect(
      badgesFor(makeInput({ mcpCalls: 200, mcpFailures: 30, activeMcpServers: 4 })).get('well_connected')!.earned,
    ).toBe(false);
    expect(
      badgesFor(makeInput({ mcpCalls: 200, mcpFailures: 10, activeMcpServers: 4 })).get('well_connected')!.earned,
    ).toBe(true);
  });

  it('orchestrator needs runs, type diversity, and success', () => {
    expect(
      badgesFor(makeInput({ subagentRuns: 25, subagentSuccesses: 23, distinctAgentTypes: 2 })).get('orchestrator')!
        .earned,
    ).toBe(true);
    expect(
      badgesFor(makeInput({ subagentRuns: 25, subagentSuccesses: 23, distinctAgentTypes: 1 })).get('orchestrator')!
        .earned,
    ).toBe(false);
    expect(
      badgesFor(makeInput({ subagentRuns: 25, subagentSuccesses: 20, distinctAgentTypes: 3 })).get('orchestrator')!
        .earned,
    ).toBe(false);
  });

  it('value badges go not-applicable when the org has no telemetry', () => {
    const noTelemetry = makeInput({
      skillInvocations: 0,
      distinctSkills: 0,
      mcpCalls: 0,
      mcpFailures: 0,
      activeMcpServers: 0,
      subagentRuns: 0,
      subagentSuccesses: 0,
      distinctAgentTypes: 0,
      planModeEntries: 0,
      plansAccepted: 0,
      compactions: 0,
    });
    const bare = computeBaselines([noTelemetry]);
    const map = new Map(
      computeBadges(noTelemetry, bare, computeAxes(noTelemetry, TARGETS, FULL_COVERAGE), TARGETS).map((b) => [b.id, b]),
    );
    for (const id of [
      'skill_smith',
      'plan_first',
      'dream_builder',
      'well_connected',
      'orchestrator',
      'deep_diver',
    ] as const) {
      expect(map.get(id)!.earned).toBe(false);
      expect(map.get(id)!.detail).toContain('Not applicable');
    }
  });

  it('deep diver needs 25 all-time compactions', () => {
    expect(badgesFor(makeInput({ compactions: 25 })).get('deep_diver')!.earned).toBe(true);
    const short = badgesFor(makeInput({ compactions: 24 })).get('deep_diver')!;
    expect(short.earned).toBe(false);
    expect(short.progress).toBeCloseTo(24 / 25, 5);
    expect(short.detail).toContain('all-time');
  });

  it('deep diver stays applicable when the only compactor is idle this range', () => {
    // The gate mirrors an all-time stat, so it must look at everyone: an org's
    // one heavy compactor being on holiday cannot turn the badge into
    // "Not applicable" for the whole org.
    const idleCompactor = makeInput({ userId: 9, sessions: 0, compactions: 60 });
    const activeNoCompactions = makeInput({ userId: 10, compactions: 0 });
    const bl = computeBaselines([idleCompactor, activeNoCompactions]);
    expect(bl.maxCompactions).toBe(60);
    const map = new Map(
      computeBadges(
        activeNoCompactions,
        bl,
        computeAxes(activeNoCompactions, TARGETS, FULL_COVERAGE),
        TARGETS,
      ).map((b) => [b.id, b]),
    );
    expect(map.get('deep_diver')!.detail).not.toContain('Not applicable');
    expect(map.get('deep_diver')!.detail).toContain('0 / 25');
  });

  it('deep diver is history-based, so a narrow range does not shrink it', () => {
    // Same person, one-week range: every range-scoped badge sees fewer
    // workdays, but compactions are counted over history — so the badge holds.
    const week = makeInput({ compactions: 40, workdays: 5, activeDays: 5 });
    expect(badgesFor(week).get('deep_diver')!.earned).toBe(true);
    expect(badgesFor(week).get('deep_diver')!.detail).toBe('40 / 25 compactions (all-time)');
  });

  it('name-collapse gates go not-applicable with a privacy message, not "no telemetry"', () => {
    // minimal privacy mode: volume survives, distinct names collapse to 1
    const redacted = makeInput({
      distinctSkills: 1,
      skillInvocations: 80,
      activeMcpServers: 1,
      mcpCalls: 400,
      distinctAgentTypes: 1,
      subagentRuns: 60,
      subagentSuccesses: 58,
    });
    const bare = computeBaselines([redacted]);
    const map = new Map(computeBadges(redacted, bare, computeAxes(redacted, TARGETS, FULL_COVERAGE), TARGETS).map((b) => [b.id, b]));
    for (const id of ['skill_smith', 'well_connected', 'orchestrator'] as const) {
      expect(map.get(id)!.earned).toBe(false);
      expect(map.get(id)!.detail).toContain('Not applicable');
      expect(map.get(id)!.detail).not.toContain('no skill telemetry');
      expect(map.get(id)!.detail).not.toContain('no MCP telemetry');
      expect(map.get(id)!.detail).not.toContain('no subagent telemetry');
      expect(map.get(id)!.detail).toContain('hidden');
    }
  });

  it('progress is clamped to 1 and reported earned at 1', () => {
    for (const badge of badgesFor(makeInput()).values()) {
      expect(badge.progress).toBeGreaterThanOrEqual(0);
      expect(badge.progress).toBeLessThanOrEqual(1);
      if (badge.earned) expect(badge.progress).toBe(1);
    }
  });

  it('guards expose their documented thresholds', () => {
    expect(GUARDS.minToolEvents).toBe(20);
    expect(GUARDS.minSessions).toBe(10);
    expect(GUARDS.minActiveDays).toBe(3);
  });
});
