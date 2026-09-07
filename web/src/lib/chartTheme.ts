import { useThemeStore } from '@/state/theme';

export interface ChartTheme {
  /** distinct series palette, consistent across dark/light */
  palette: string[];
  fg: string;
  muted: string;
  border: string;
  card: string;
  bg: string;
  accent: string;
  accent2: string;
  good: string;
  warn: string;
  risk: string;
  tier: Record<'starter' | 'explorer' | 'producer' | 'champion', string>;
  isDark: boolean;
}

function cssVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/** Read chart colors from CSS custom properties at render time. */
export function readChartTheme(): ChartTheme {
  const el = document.documentElement;
  const styles = getComputedStyle(el);
  const isDark = el.classList.contains('dark');
  return {
    palette: [
      cssVar(styles, '--chart-1', '#d97757'),
      cssVar(styles, '--chart-2', '#7c6aef'),
      cssVar(styles, '--chart-3', '#0ea5e9'),
      cssVar(styles, '--chart-4', '#10b981'),
      cssVar(styles, '--chart-5', '#f59e0b'),
      cssVar(styles, '--chart-6', '#ec4899'),
      cssVar(styles, '--chart-7', '#14b8a6'),
      cssVar(styles, '--chart-8', '#64748b'),
    ],
    fg: cssVar(styles, '--fg', '#e7ebf3'),
    muted: cssVar(styles, '--muted', '#8b93a7'),
    border: cssVar(styles, '--border', '#232936'),
    card: cssVar(styles, '--card', '#12161f'),
    bg: cssVar(styles, '--bg', '#0b0e14'),
    accent: cssVar(styles, '--accent', '#d97757'),
    accent2: cssVar(styles, '--accent-2', '#7c6aef'),
    good: cssVar(styles, '--good', '#34d399'),
    warn: cssVar(styles, '--warn', '#fbbf24'),
    risk: cssVar(styles, '--risk', '#f87171'),
    tier: {
      starter: cssVar(styles, '--tier-starter', '#94a3b8'),
      explorer: cssVar(styles, '--tier-explorer', '#38bdf8'),
      producer: cssVar(styles, '--tier-producer', '#34d399'),
      champion: cssVar(styles, '--tier-champion', '#fbbf24'),
    },
    isDark,
  };
}

/**
 * Subscribes to the theme store so any component building chart options
 * re-renders (and re-reads CSS variables) when the theme flips.
 */
export function useChartTheme(): ChartTheme {
  useThemeStore((s) => s.theme);
  return readChartTheme();
}

/** Shared axis/tooltip scaffolding for cartesian charts. */
export function baseChrome(t: ChartTheme) {
  return {
    textStyle: { color: t.fg, fontFamily: 'inherit' },
    tooltip: {
      trigger: 'axis' as const,
      backgroundColor: t.card,
      borderColor: t.border,
      textStyle: { color: t.fg, fontSize: 12 },
    },
    grid: { left: 8, right: 12, top: 32, bottom: 4, containLabel: true },
  };
}

/**
 * Layout for charts that have BOTH a top-right legend and named y-axes. ECharts
 * draws an axis name just above the axis end, i.e. in the same row as the
 * legend, so "sessions" collided with the "Sessions" legend item. Give the
 * legend row 1 and the axis names row 2: grid.top makes room, nameGap pulls
 * the names down under the legend.
 */
export const NAMED_AXIS_GRID_TOP = 48;
export const NAMED_AXIS_NAME_GAP = 10;

export function axisStyle(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.border } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.border, opacity: 0.6 } },
  };
}

/** Loosely-typed tooltip callback param (echarts' own union is unwieldy). */
export interface TipParams {
  seriesName?: string;
  name?: string;
  value?: unknown;
  data?: unknown;
  marker?: string;
  color?: string;
  dataIndex?: number;
  percent?: number;
  axisValueLabel?: string;
}

export function asTipArray(raw: unknown): TipParams[] {
  return (Array.isArray(raw) ? raw : [raw]) as TipParams[];
}
