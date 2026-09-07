import { DateTime } from 'luxon';
import { displayZone, nowLocal } from './time';

/** cents → "$12.34" under $100, "$1,234" above. */
export function fmtCost(cents: number): string {
  const dollars = cents / 100;
  const sign = dollars < 0 ? '-' : '';
  const abs = Math.abs(dollars);
  if (abs < 100) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
}

export function fmtTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function fmtNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (abs >= 100_000) return `${Math.round(n / 1000).toLocaleString('en-US')}K`;
  return Math.round(n).toLocaleString('en-US');
}

export function fmtSigned(n: number): string {
  return `${n > 0 ? '+' : ''}${fmtNumber(n)}`;
}

/** ratio 0..1 → "62%". null → em-dash. */
export function fmtPct(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** value already in percent units (0..100). */
export function fmtPct100(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function fmtScore(v: number | null): string {
  return v === null ? '—' : v.toFixed(0);
}

/** ISO datetime → "2h ago" */
export function relativeIso(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return '—';
  return dt.toRelative({ style: 'narrow' }) ?? '—';
}

/** 'YYYY-MM-DD' → "3d ago" / "today" */
export function relativeDate(date: string | null | undefined): string {
  if (!date) return 'never';
  const dt = DateTime.fromISO(date, { zone: displayZone() }).startOf('day');
  if (!dt.isValid) return '—';
  const today = nowLocal().startOf('day');
  const days = Math.round(today.diff(dt, 'days').days);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

/**
 * ISO instant → "today at 14:37" / "yesterday at 09:05" / "Jul 20 at 14:37"
 * (year added when it differs), in the display zone. null → '—'.
 */
export function relativeDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(displayZone());
  if (!dt.isValid) return '—';
  const time = dt.toFormat('HH:mm');
  const today = nowLocal().startOf('day');
  const days = Math.round(today.diff(dt.startOf('day'), 'days').days);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const day = dt.year === today.year ? dt.toFormat('LLL d') : dt.toFormat('LLL d, yyyy');
  return `${day} at ${time}`;
}

export function daysSince(date: string | null | undefined): number | null {
  if (!date) return null;
  const dt = DateTime.fromISO(date, { zone: displayZone() }).startOf('day');
  if (!dt.isValid) return null;
  return Math.round(nowLocal().startOf('day').diff(dt, 'days').days);
}

export function fmtDateShort(date: string): string {
  const dt = DateTime.fromISO(date, { zone: 'utc' });
  return dt.isValid ? dt.toFormat('MMM d') : date;
}

export function fmtDateLong(date: string | null | undefined): string {
  if (!date) return '—';
  const dt = DateTime.fromISO(date, { zone: 'utc' });
  return dt.isValid ? dt.toFormat('MMM d, yyyy') : date;
}

export function fmtHours(h: number): string {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}K hrs`;
  if (h >= 10) return `${Math.round(h)} hrs`;
  return `${h.toFixed(1)} hrs`;
}

/** seconds → "38h 12m" / "42m" / "45s". */
export function fmtDurationSec(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const totalMin = Math.round(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${fmtNumber(h)}h ${String(m).padStart(2, '0')}m`;
}

/** milliseconds → "1h 24m" / "24m" / "45s". null → em-dash. */
export function fmtDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  return fmtDurationSec(ms / 1000);
}

/** Format a bucket key produced by lib/time bucketKey for axis labels. */
export function fmtBucket(bucket: string, gran: 'day' | 'week' | 'month'): string {
  if (gran === 'month') {
    const dt = DateTime.fromISO(`${bucket}-01`, { zone: 'utc' });
    return dt.isValid ? dt.toFormat('MMM yy') : bucket;
  }
  const dt = DateTime.fromISO(bucket, { zone: 'utc' });
  if (!dt.isValid) return bucket;
  return gran === 'week' ? `w/${dt.toFormat('MMM d')}` : dt.toFormat('MMM d');
}
