import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DateTime } from 'luxon';
import type { Granularity } from '@dash/shared';
import { nowLocal } from '@/lib/time';

export type RangePreset = 'today' | '7d' | '30d' | '90d' | 'qtd' | 'custom';

export const RANGE_PRESETS: Array<{ id: RangePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: 'qtd', label: 'QTD' },
  { id: 'custom', label: 'Custom' },
];

function presetRange(preset: RangePreset, fromParam: string | null, toParam: string | null) {
  // the org-local day, matching how the daily tables are keyed — a UTC
  // 'today' hides the current day until 03:00 local time
  const today = nowLocal().startOf('day');
  const to = today.toISODate();
  switch (preset) {
    case 'today':
      // a single org-local day; every endpoint accepts from === to
      return { from: to, to };
    case '7d':
      return { from: today.minus({ days: 6 }).toISODate(), to };
    case '90d':
      return { from: today.minus({ days: 89 }).toISODate(), to };
    case 'qtd':
      return { from: today.startOf('quarter').toISODate(), to };
    case 'custom': {
      const from = fromParam && DateTime.fromISO(fromParam).isValid ? fromParam : today.minus({ days: 29 }).toISODate();
      const end = toParam && DateTime.fromISO(toParam).isValid ? toParam : to;
      return { from, to: end };
    }
    case '30d':
    default:
      return { from: today.minus({ days: 29 }).toISODate(), to };
  }
}

export interface RangeParams {
  preset: RangePreset;
  from: string;
  to: string;
  gran: Granularity;
  /** raw team id from URL (string) or undefined */
  teamId: string | undefined;
  compare: string[];
  setPreset: (p: RangePreset) => void;
  setCustom: (from: string, to: string) => void;
  setGran: (g: Granularity) => void;
  setTeamId: (id: string | undefined) => void;
  setCompare: (emails: string[]) => void;
}

/** URL keys that describe the analysis window — carried along when moving between pages. */
export const RANGE_SEARCH_KEYS = ['range', 'from', 'to', 'gran', 'team'] as const;

/**
 * The current range as a search string ("?range=7d&team=3", or "") for links
 * that switch pages: without it a menu click lands on the page's default
 * (30D), which reads as the filter "jumping back". Page-specific keys such as
 * `compare` are deliberately left behind.
 */
export function useRangeSearch(): string {
  const [searchParams] = useSearchParams();
  return useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of RANGE_SEARCH_KEYS) {
      const v = searchParams.get(key);
      if (v) sp.set(key, v);
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
  }, [searchParams]);
}

/** All analytics state lives in the URL so deep links are shareable. */
export function useRangeParams(): RangeParams {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawRange = searchParams.get('range');
  const preset: RangePreset =
    rawRange === 'today' ||
    rawRange === '7d' ||
    rawRange === '30d' ||
    rawRange === '90d' ||
    rawRange === 'qtd' ||
    rawRange === 'custom'
      ? rawRange
      : '30d';
  const rawGran = searchParams.get('gran');
  const gran: Granularity = rawGran === 'week' || rawGran === 'month' ? rawGran : 'day';
  const teamId = searchParams.get('team') ?? undefined;
  const compareRaw = searchParams.get('compare');
  const compare = useMemo(
    () => (compareRaw ? compareRaw.split(',').filter(Boolean) : []),
    [compareRaw],
  );

  const { from, to } = useMemo(
    () => presetRange(preset, searchParams.get('from'), searchParams.get('to')),
    [preset, searchParams],
  );

  const update = useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          mutate(sp);
          return sp;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const setPreset = useCallback(
    (p: RangePreset) =>
      update((sp) => {
        sp.set('range', p);
        if (p !== 'custom') {
          sp.delete('from');
          sp.delete('to');
        }
      }),
    [update],
  );

  const setCustom = useCallback(
    (f: string, t: string) =>
      update((sp) => {
        sp.set('range', 'custom');
        sp.set('from', f);
        sp.set('to', t);
      }),
    [update],
  );

  const setGran = useCallback(
    (g: Granularity) => update((sp) => sp.set('gran', g)),
    [update],
  );

  const setTeamId = useCallback(
    (id: string | undefined) =>
      update((sp) => {
        if (id) sp.set('team', id);
        else sp.delete('team');
      }),
    [update],
  );

  const setCompare = useCallback(
    (emails: string[]) =>
      update((sp) => {
        if (emails.length > 0) sp.set('compare', emails.join(','));
        else sp.delete('compare');
      }),
    [update],
  );

  return { preset, from, to, gran, teamId, compare, setPreset, setCustom, setGran, setTeamId, setCompare };
}
