import { DateTime } from 'luxon';
import type { Granularity, HeatmapHour } from '@dash/shared';

const FALLBACK_ZONE = 'Asia/Jerusalem';

/**
 * The zone the server keys its daily tables by (ORG_TIMEZONE), reported through
 * /api/settings and set once on load. Until then the default holds — every
 * consumer reads it through `displayZone()` so a later arrival is picked up.
 */
let zone = FALLBACK_ZONE;

export function setDisplayZone(tz: string | undefined | null): void {
  if (tz && DateTime.now().setZone(tz).isValid) zone = tz;
}

export function displayZone(): string {
  return zone;
}

/**
 * Now in the display zone — the zone the daily tables are keyed by, so every
 * calendar-day comparison in the UI must start here rather than at UTC (a UTC
 * "today" hides the current day until 03:00 local). The zone is validated in
 * `setDisplayZone`, so the result is always a valid DateTime.
 */
export function nowLocal(): DateTime<true> {
  return DateTime.now().setZone(zone) as DateTime<true>;
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Convert a UTC hour bucket ('YYYY-MM-DDTHH:00:00Z') to the weekday/hour in the
 * display zone (ORG_TIMEZONE, see `setDisplayZone`). DST-aware in any zone
 * because luxon converts the actual instant, not the wall clock.
 * weekday: 0=Sun … 6=Sat.
 */
export function utcHourToLocal(hourUtc: string): { weekday: number; hour: number } {
  const dt = DateTime.fromISO(hourUtc, { zone: 'utc' }).setZone(zone);
  // luxon: 1=Mon … 7=Sun → 0=Sun … 6=Sat
  return { weekday: dt.weekday % 7, hour: dt.hour };
}

export interface HeatmapBins {
  /** [weekday 0=Sun..6][hour 0..23] absolute values */
  abs: number[][];
  /** row-normalized 0..1 (each row divided by its own max) */
  norm: number[][];
  total: number;
  max: number;
  peak: { weekday: number; hour: number; value: number } | null;
}

/** Bin raw UTC hours into a 7×24 Jerusalem-local matrix. */
export function binHeatmap(
  hours: HeatmapHour[],
  value: (h: HeatmapHour) => number = (h) => h.tokens,
): HeatmapBins {
  const abs: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let total = 0;
  for (const h of hours) {
    const { weekday, hour } = utcHourToLocal(h.hourUtc);
    const v = value(h);
    const row = abs[weekday];
    if (row) row[hour] = (row[hour] ?? 0) + v;
    total += v;
  }
  let max = 0;
  let peak: HeatmapBins['peak'] = null;
  for (let w = 0; w < 7; w++) {
    for (let hr = 0; hr < 24; hr++) {
      const v = abs[w]?.[hr] ?? 0;
      if (v > max) {
        max = v;
        peak = { weekday: w, hour: hr, value: v };
      }
    }
  }
  const norm = abs.map((row) => {
    const rowMax = row.reduce((m, v) => Math.max(m, v), 0);
    return row.map((v) => (rowMax > 0 ? v / rowMax : 0));
  });
  return { abs, norm, total, max, peak };
}

/** Bucket key for a 'YYYY-MM-DD' date under a granularity. Weeks start Sunday. */
export function bucketKey(date: string, gran: Granularity): string {
  if (gran === 'day') return date;
  const dt = DateTime.fromISO(date, { zone: 'utc' });
  if (!dt.isValid) return date;
  if (gran === 'month') return dt.toFormat('yyyy-MM');
  const dow = dt.weekday % 7; // 0=Sun
  return dt.minus({ days: dow }).toISODate() ?? date;
}

export interface Bucket<T> {
  bucket: string;
  rows: T[];
}

/** Group dated rows into sorted granularity buckets. */
export function bucketRows<T extends { date: string }>(rows: T[], gran: Granularity): Bucket<T>[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = bucketKey(r.date, gran);
    const arr = map.get(k);
    if (arr) arr.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([bucket, bucketRowsArr]) => ({ bucket, rows: bucketRowsArr }));
}

export function sumBy<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((acc, r) => acc + f(r), 0);
}

export function maxBy<T>(rows: T[], f: (r: T) => number): number {
  return rows.reduce((acc, r) => Math.max(acc, f(r)), 0);
}

/** Today's 'YYYY-MM-DD' in the display zone. */
/** The window of equal length immediately before [from, to] — for "vs previous period" deltas. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const f = DateTime.fromISO(from, { zone });
  const t = DateTime.fromISO(to, { zone });
  const days = Math.max(1, Math.round(t.diff(f, 'days').days) + 1);
  return {
    from: f.minus({ days }).toISODate() ?? from,
    to: f.minus({ days: 1 }).toISODate() ?? from,
  };
}

export function todayLocal(): string {
  return nowLocal().toISODate();
}
