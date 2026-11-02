/**
 * Work-week math over 'YYYY-MM-DD' date strings, plus the org-local ⇄ UTC
 * conversions the daily and hourly tables need.
 *
 * Streaks have no single org work week: `expectedWeekdays` learns each person's
 * from their own history, so Sun–Thu, Mon–Fri and a six-day week all measure the
 * same way. The org's configured week (`WORKWEEK`, see `parseWorkweek`; default
 * Sun–Thu) is only the no-history fallback there, and the calendar that
 * `workdaysBetween` counts for scoring targets. `WEEK_START` (default Sunday)
 * decides where week buckets begin (`weekStartOf`). Nothing here reads env —
 * the server resolves both once at boot and passes them in.
 * Daily dates are ORG-LOCAL calendar days (see `localDateOf`,
 * used by the telemetry ingest) — the weekday is a property of the date string
 * itself, no timezone conversion involved there. Hour tables stay UTC, so any
 * hour-bounded query over a local-day range must go through
 * `utcHourRangeOfLocalDays` rather than pasting 'T00:00:00Z' onto a local date.
 *
 * The zone defaults to Asia/Jerusalem and is overridable per call; the server
 * passes ORG_TIMEZONE.
 */

const DAY_MS = 86_400_000;

export const DEFAULT_ORG_TIMEZONE = 'Asia/Jerusalem';

/**
 * Numeric parts of an instant in `tz`. Formatters are cached per zone and read
 * through `formatToParts`: a locale's *pattern* is not guaranteed (an ICU build
 * without en-CA falls back to en-US and yields '07/29/2026'), but the part
 * values are, and these values become database keys.
 */
const partsFmtByZone = new Map<string, Intl.DateTimeFormat>();

function partsOf(instant: Date, tz: string): Record<string, number> {
  let fmt = partsFmtByZone.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFmtByZone.set(tz, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Org-local calendar day of an instant. The daily bucket MUST be local:
 * everything downstream (work week, streaks, active days) is local, so
 * a UTC key files work done after midnight local time under the previous day —
 * silently emptying the new day and breaking streaks.
 */
export function localDateOf(instant: string | Date, tz: string = DEFAULT_ORG_TIMEZONE): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new RangeError(`localDateOf: invalid instant ${String(instant)}`);
  const p = partsOf(d, tz);
  // h23 renders midnight as 00, but a stray '24' would still belong to that day
  return `${pad(p['year'] ?? 0, 4)}-${pad(p['month'] ?? 1)}-${pad(p['day'] ?? 1)}`;
}

/** ms to add to a UTC instant to get its wall-clock reading in `tz`. */
function zoneOffsetMs(instantMs: number, tz: string): number {
  const p = partsOf(new Date(instantMs), tz);
  const wall = Date.UTC(
    p['year'] ?? 1970,
    (p['month'] ?? 1) - 1,
    p['day'] ?? 1,
    (p['hour'] ?? 0) % 24,
    p['minute'] ?? 0,
    p['second'] ?? 0,
  );
  return wall - instantMs;
}

/** UTC instant of a local wall-clock time, given that time as if it were UTC. */
function instantOfLocalWall(wallAsUtcMs: number, tz: string): number {
  // one correction pass, then a second so a DST shift between the guess and the
  // corrected instant still resolves
  const guess = wallAsUtcMs - zoneOffsetMs(wallAsUtcMs, tz);
  return wallAsUtcMs - zoneOffsetMs(guess, tz);
}

/**
 * UTC hour buckets ('YYYY-MM-DDTHH:00:00Z') spanning the local days
 * [from, to] inclusive. The hour tables are keyed by UTC hour while every range
 * in the app is a local day; string-pasting 'T00:00:00Z' onto a local date
 * shifts the window by the zone offset, which drops the range's first local
 * hours and leaks the same number from the day after `to`.
 */
export function utcHourRangeOfLocalDays(
  from: string,
  to: string,
  tz: string = DEFAULT_ORG_TIMEZONE,
): { fromHour: string; toHour: string } {
  const startMs = instantOfLocalWall(Date.parse(`${from}T00:00:00Z`), tz);
  const endMs = instantOfLocalWall(Date.parse(`${to}T23:00:00Z`), tz);
  return {
    fromHour: `${new Date(startMs).toISOString().slice(0, 13)}:00:00Z`,
    toHour: `${new Date(endMs).toISOString().slice(0, 13)}:00:00Z`,
  };
}

export function toUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return toDateString(new Date(toUtcDate(date).getTime() + days * DAY_MS));
}

/** 0=Sunday … 6=Saturday */
export function weekdayOf(date: string): number {
  return toUtcDate(date).getUTCDay();
}

/**
 * Sun–Thu: the `WORKWEEK` default. The helpers below take the week explicitly
 * (no default), so a call that forgets the configured calendar fails to compile.
 */
export const DEFAULT_WORKWEEK: ReadonlySet<number> = new Set([0, 1, 2, 3, 4]);

/** First day of a week bucket: 0=Sunday, 1=Monday. */
export type WeekStart = 0 | 1;

export const DEFAULT_WEEK_START: WeekStart = 0;

const DAY_NAMES: readonly string[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (wd: number): string => DAY_LABELS[wd] ?? String(wd);

const WORKWEEK_PRESETS: Record<string, readonly number[]> = {
  'sun-thu': [0, 1, 2, 3, 4],
  'mon-fri': [1, 2, 3, 4, 5],
};

const WORKWEEK_HINT = 'use sun-thu, mon-fri, or a list like mon,tue,wed,thu,fri (or numbers 0–6, 0=Sunday, e.g. 1,2,3,4,5)';

/**
 * Parse a WORKWEEK value: one of the two presets ('sun-thu', 'mon-fri') or, for
 * any other week, a comma list of day names ('mon,tue,wed,thu,fri') or numbers
 * ('0,1,2,3,4', 0=Sunday). Case and whitespace are ignored and duplicates
 * collapse. Throws a RangeError on an unknown day or a list with no days in it,
 * so a typo fails boot instead of quietly scoring everyone against the wrong
 * week.
 */
export function parseWorkweek(spec: string): ReadonlySet<number> {
  const normalized = spec.trim().toLowerCase();
  const preset = WORKWEEK_PRESETS[normalized];
  if (preset) return new Set(preset);
  const days = new Set<number>();
  for (const raw of normalized.split(',')) {
    const token = raw.trim();
    if (token === '') continue;
    const wd = /^[0-6]$/.test(token) ? Number(token) : DAY_NAMES.indexOf(token);
    if (wd < 0) throw new RangeError(`unknown day "${token}" — ${WORKWEEK_HINT}`);
    days.add(wd);
  }
  if (days.size === 0) throw new RangeError(`no days in "${spec}" — ${WORKWEEK_HINT}`);
  return days;
}

/** Parse a WEEK_START value ('sun' | 'mon', any case); throws a RangeError otherwise. */
export function parseWeekStart(spec: string): WeekStart {
  const normalized = spec.trim().toLowerCase();
  if (normalized === 'sun') return 0;
  if (normalized === 'mon') return 1;
  throw new RangeError(`unknown week start "${spec.trim()}" — use sun or mon`);
}

export function isWorkday(date: string, workweek: ReadonlySet<number>): boolean {
  return workweek.has(weekdayOf(date));
}

/**
 * Start date of the week containing `date`. The SQL week bucket in usageRepo
 * uses the same arithmetic — (weekday + 7 - weekStart) % 7 days back — so the
 * server's buckets and the client's labels always agree.
 */
export function weekStartOf(date: string, weekStart: WeekStart): string {
  return addDays(date, -((weekdayOf(date) + 7 - weekStart) % 7));
}

/** Weekdays (0=Sunday) in display order, starting at `weekStart`. */
export function weekdayOrder(weekStart: WeekStart): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStart) % 7);
}

/**
 * Human label for a work week: one contiguous run (it may wrap past Saturday)
 * reads 'Sun–Thu' / 'Mon–Fri', anything else is a list in week order.
 */
export function formatWorkweek(workweek: ReadonlySet<number>, weekStart: WeekStart): string {
  const days = weekdayOrder(weekStart).filter((wd) => workweek.has(wd));
  if (days.length === 0) return '—';
  if (days.length === 1) return dayLabel(days[0] ?? 0);
  if (days.length === 7) return `${dayLabel(weekStart)}–${dayLabel((weekStart + 6) % 7)}`;
  // a run starts on a workday whose previous day is off
  const runStarts = days.filter((wd) => !workweek.has((wd + 6) % 7));
  const start = runStarts[0];
  if (runStarts.length === 1 && start !== undefined) {
    return `${dayLabel(start)}–${dayLabel((start + days.length - 1) % 7)}`;
  }
  return days.map(dayLabel).join(', ');
}

/** A weekday counts as "expected" once the person works at least half of them. */
const EXPECTED_DAY_RATE = 0.5;

/**
 * At most this many consecutive IDLE rest days can be bridged — a full week
 * away breaks a streak no matter whose schedule it is. Also bounds the backward
 * walk for someone with no established pattern yet. Both streak functions must
 * enforce the same number, or `current` can exceed `best` over the same set.
 */
const MAX_IDLE_BRIDGE_DAYS = 6;

/**
 * The weekdays this person is expected to work, learned from their own history
 * in [from, to] — a weekday they were active on at least half the time.
 *
 * There is no org-wide work week to hardcode: a team can span Israel (Sun–Thu),
 * the US (Mon–Fri), and someone who genuinely works Saturdays, and a fixed
 * calendar punishes everyone it doesn't describe. Deriving it per person needs
 * no configuration and no one filling in a form.
 *
 * With little history almost nothing is "expected", so early streaks are
 * generous and tighten as the pattern emerges; `fallback` only applies when
 * there is no history at all.
 */
export function expectedWeekdays(
  activeDates: ReadonlySet<string>,
  from: string,
  to: string,
  fallback: ReadonlySet<number>,
): ReadonlySet<number> {
  const occurrences = new Array<number>(7).fill(0);
  const active = new Array<number>(7).fill(0);
  const end = toUtcDate(to).getTime();
  for (let t = toUtcDate(from).getTime(); t <= end; t += DAY_MS) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    occurrences[wd] = (occurrences[wd] ?? 0) + 1;
    if (activeDates.has(toDateString(d))) active[wd] = (active[wd] ?? 0) + 1;
  }
  if (activeDates.size === 0) return fallback;
  const expected = new Set<number>();
  for (let wd = 0; wd < 7; wd++) {
    const seen = occurrences[wd] ?? 0;
    if (seen > 0 && (active[wd] ?? 0) / seen >= EXPECTED_DAY_RATE) expected.add(wd);
  }
  return expected;
}

/** Count the days of `workweek` in [from, to] inclusive. */
export function workdaysBetween(from: string, to: string, workweek: ReadonlySet<number>): number {
  let count = 0;
  const end = toUtcDate(to).getTime();
  for (let t = toUtcDate(from).getTime(); t <= end; t += DAY_MS) {
    if (workweek.has(new Date(t).getUTCDay())) count++;
  }
  return count;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcDate(to).getTime() - toUtcDate(from).getTime()) / DAY_MS);
}

/**
 * Walk back from `date` to the first day that decides the streak: one the person
 * was active on (any day they worked counts, Saturday included), or one they
 * were expected to work — idle there, and the streak is over. Idle rest days in
 * between are skipped, up to MAX_IDLE_BRIDGE_DAYS of them.
 *
 * Returns null once the cap is exhausted, so every day the caller sees has been
 * checked; returning the unchecked cursor instead let an eighth day bridge.
 */
function decidingDayAtOrBefore(
  activeDates: ReadonlySet<string>,
  expected: ReadonlySet<number>,
  date: string,
): string | null {
  let cursor = date;
  for (let skipped = 0; skipped <= MAX_IDLE_BRIDGE_DAYS; skipped++) {
    if (activeDates.has(cursor) || expected.has(weekdayOf(cursor))) return cursor;
    cursor = addDays(cursor, -1);
  }
  return null;
}

/**
 * Current streak of consecutive active days ending at (or just before) `asOf`,
 * measured against the person's own `expected` weekdays: idle days they weren't
 * expected to work are skipped, and any day they WERE active counts. If the last
 * counting day is idle (e.g. today, partial data), it is granted grace — the
 * streak is measured one counting day earlier, but only once, and only for
 * `asOf` itself.
 */
export function currentWorkdayStreak(
  activeDates: ReadonlySet<string>,
  asOf: string,
  expected: ReadonlySet<number>,
): number {
  let cursor = decidingDayAtOrBefore(activeDates, expected, asOf);
  if (cursor !== null && !activeDates.has(cursor)) {
    // grace only when the missing day is asOf itself (or the rewind of it)
    cursor = decidingDayAtOrBefore(activeDates, expected, addDays(cursor, -1));
  }
  let streak = 0;
  while (cursor !== null && activeDates.has(cursor)) {
    streak++;
    cursor = decidingDayAtOrBefore(activeDates, expected, addDays(cursor, -1));
  }
  return streak;
}

/**
 * Longest run of active days anywhere in the set, bridging only the person's own
 * idle rest days — the same cap `currentWorkdayStreak` enforces, so the two can
 * never disagree about whether a gap is contiguous.
 */
export function bestWorkdayStreak(activeDates: ReadonlySet<string>, expected: ReadonlySet<number>): number {
  if (activeDates.size === 0) return 0;
  const sorted = [...activeDates].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    // contiguous when every day between prev and date was an idle rest day
    // a gap of N days has N-1 idle days in it
    let contiguous = prev !== null && daysBetween(prev, date) <= MAX_IDLE_BRIDGE_DAYS + 1;
    if (contiguous && prev !== null) {
      for (let d = addDays(prev, 1); d < date; d = addDays(d, 1)) {
        if (expected.has(weekdayOf(d))) {
          contiguous = false;
          break;
        }
      }
    }
    run = contiguous ? run + 1 : 1;
    if (run > best) best = run;
    prev = date;
  }
  return best;
}
