/** UTC + org-local time helpers used by scoring, sync and the seeder. */
import { DEFAULT_ORG_TIMEZONE, localDateOf, type StreakMode } from '@dash/shared';

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The zone the daily tables are keyed by. Set ONCE at boot from ORG_TIMEZONE so
 * pure helpers (and the ingest hot path) can read it without threading env
 * through every call; defaults to Asia/Jerusalem for anyone who never calls it.
 */
let resolvedOrgTimezone = DEFAULT_ORG_TIMEZONE;

export function configureOrgTimezone(tz: string): void {
  resolvedOrgTimezone = tz;
}

export function orgTimezone(): string {
  return resolvedOrgTimezone;
}

/** The org's streak rule, set once at boot from STREAK_MODE. */
let resolvedStreakMode: StreakMode = 'workweek';

export function configureStreakMode(mode: StreakMode): void {
  resolvedStreakMode = mode;
}

export function streakMode(): StreakMode {
  return resolvedStreakMode;
}

/**
 * Today in the org's local zone — the zone the daily tables are keyed by. Any
 * read path that compares against a `date` column must use this; the Admin-API
 * sync paths keep `todayUtc()` because Anthropic buckets by UTC day.
 */
export function todayLocal(): string {
  return localDateOf(new Date(), resolvedOrgTimezone);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 'YYYY-MM-DDTHH:00:00Z' for any Date. */
export function hourIsoOf(d: Date): string {
  return `${d.toISOString().slice(0, 13)}:00:00Z`;
}

/** Truncate any RFC3339 UTC timestamp to its hour bucket 'YYYY-MM-DDTHH:00:00Z'. */
export function truncToHourIso(iso: string): string {
  return `${new Date(iso).toISOString().slice(0, 13)}:00:00Z`;
}

/**
 * Hour-of-day in the ORG zone. Night Owl / Early Bird are "what time was it for
 * you", so this has to follow ORG_TIMEZONE like the daily keys do — computing a
 * New York team's night in Israeli hours is off by seven.
 *
 * The formatter and the memo are both keyed by zone, so `configureOrgTimezone`
 * during boot (or a different zone in a test) can never serve a stale hour.
 */
const hourFmtByZone = new Map<string, Intl.DateTimeFormat>();
const hourCache = new Map<string, number>();

/** Org-local hour (0-23) of a UTC hour timestamp; DST-correct via Intl. */
export function localHourOfUtc(hourUtcIso: string): number {
  const tz = resolvedOrgTimezone;
  const key = `${tz}|${hourUtcIso}`;
  let v = hourCache.get(key);
  if (v === undefined) {
    let fmt = hourFmtByZone.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
      hourFmtByZone.set(tz, fmt);
    }
    v = Number(fmt.format(new Date(hourUtcIso))) % 24;
    hourCache.set(key, v);
  }
  return v;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const weekdayFmtByZone = new Map<string, Intl.DateTimeFormat>();
const weekdayCache = new Map<string, number>();

/** Org-local weekday (0=Sunday .. 6=Saturday) of a UTC hour timestamp. */
export function localWeekdayOfUtc(hourUtcIso: string): number {
  const tz = resolvedOrgTimezone;
  const key = `${tz}|${hourUtcIso}`;
  let v = weekdayCache.get(key);
  if (v === undefined) {
    let fmt = weekdayFmtByZone.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' });
      weekdayFmtByZone.set(tz, fmt);
    }
    v = WEEKDAY_INDEX[fmt.format(new Date(hourUtcIso))] ?? 0;
    weekdayCache.set(key, v);
  }
  return v;
}

/**
 * Is an org-local hour inside [startHour, endHour)? Windows may wrap midnight
 * (22 → 5), which is why this can't be a plain range check. Both bounds come
 * from settings (`scoreTargets.timeBadges`), so the night/early windows are an
 * org decision rather than a constant baked in here.
 */
export function hourInWindow(h: number, startHour: number, endHour: number): boolean {
  return startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
}
