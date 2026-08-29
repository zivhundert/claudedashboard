import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ORG_TIMEZONE, type DataSourceDto, type PrivacyMode, type StreakMode } from '@dash/shared';
import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Repo root, independent of process.cwd() — `pnpm --filter @dash/server dev`
 * runs with cwd=server/, so relative DB_PATH/WEB_DIST_PATH must not resolve
 * against cwd. This file lives at server/src/env.ts in dev and is bundled to
 * server/dist/index.js in prod; '../..' reaches the repo root from both.
 */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Absolute paths (e.g. Docker) pass through untouched; relative ones anchor at the repo root. */
export function resolveFromRepoRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(REPO_ROOT, p);
}

/**
 * tsx does not auto-load .env — locate one at cwd or up to 3 parent dirs
 * (repo root when the server is started from server/) and merge it into
 * process.env WITHOUT overriding variables that are already set.
 */
export function loadDotEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const file = path.join(dir, '.env');
    if (fs.existsSync(file)) {
      applyEnvFile(file);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function applyEnvFile(file: string): void {
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
  ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const emptyToUndef = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const boolishToNum = (v: unknown): unknown => {
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === '') return undefined;
    if (t === 'true' || t === 'yes' || t === 'on') return 1;
    if (t === 'false' || t === 'no' || t === 'off') return 0;
  }
  return v;
};

const schema = z.object({
  ADMIN_API_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  ENTERPRISE_ANALYTICS_KEY: z.preprocess(emptyToUndef, z.string().optional()),
  ENTERPRISE_API_BASE: z.preprocess(emptyToUndef, z.string().url().default('https://api.anthropic.com')),
  /** Test-only: min gap between Enterprise Analytics requests (org-wide 60/min → 1100ms). */
  ENTERPRISE_PACE_MS: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).default(1100)),
  PORT: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(65535).default(8080)),
  DB_PATH: z.preprocess(emptyToUndef, z.string().default('./data/dashboard.db')),
  SYNC_CRON: z.preprocess(emptyToUndef, z.string().default('0 5 * * *')),
  SYNC_TZ: z.preprocess(emptyToUndef, z.string().default('Asia/Jerusalem')),
  INTRADAY_SYNC_MINUTES: z.preprocess(emptyToUndef, z.coerce.number().int().min(0).default(60)),
  BACKFILL_START: z.preprocess(emptyToUndef, z.string().regex(DATE_RE).optional()),
  BACKFILL_EMPTY_STREAK: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).default(14)),
  HOURLY_BACKFILL_DAYS: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).default(30)),
  DEMO_MODE: z.preprocess(boolishToNum, z.coerce.number().default(0)),
  WEB_DIST_PATH: z.preprocess(emptyToUndef, z.string().default('web/dist')),
  /** When set, POST /otel/* requires `Authorization: Bearer <token>`. */
  OTEL_INGEST_TOKEN: z.preprocess(emptyToUndef, z.string().optional()),
  /**
   * Max OTLP batch size. Fastify's 1 MiB default silently 413s busy exporters;
   * every accepted byte is JSON.parsed synchronously, so this is also the DoS
   * surface of an unauthenticated receiver — raise it only as far as the
   * otel_batch_too_large counter says you need.
   */
  OTEL_MAX_BODY_MB: z.preprocess(emptyToUndef, z.coerce.number().int().min(1).max(512).default(8)),
  /** IANA zone the daily tables are keyed by, and the org work-week's zone. */
  ORG_TIMEZONE: z.preprocess(emptyToUndef, z.string().default(DEFAULT_ORG_TIMEZONE)),
  /**
   * Which streak rule the org runs. `workweek` (default) measures against the
   * weekdays each person actually works, so their usual days off don't break a
   * run; `calendar` counts consecutive days and any gap ends one. Streak badge
   * thresholds mean different things under each — see scoreTargets.streaks.
   */
  STREAK_MODE: z.preprocess(emptyToUndef, z.enum(['workweek', 'calendar']).default('workweek')),
  /** Explicit data-source override; keys are still validated per source. */
  DATA_SOURCE: z.preprocess(emptyToUndef, z.enum(['demo', 'telemetry', 'console', 'enterprise']).optional()),
  /** How much detail the OTel receiver keeps (see otel/privacy.ts). */
  PRIVACY_MODE: z.preprocess(emptyToUndef, z.enum(['full', 'balanced', 'minimal']).default('balanced')),
});

/** Which upstream feeds the SQLite tables (the shared DTO is the one contract). */
export type DataSource = DataSourceDto;

export interface Env {
  /**
   * demo → seeded data; enterprise → claude.ai Enterprise Analytics API;
   * console → Console Admin API; telemetry → the OTLP push receiver is the
   * primary feed (keyless boot).
   */
  dataSource: DataSourceDto;
  /** How much detail the OTel receiver keeps ('balanced' unless overridden). */
  privacyMode: PrivacyMode;
  adminApiKey: string | null;
  enterpriseAnalyticsKey: string | null;
  enterpriseApiBase: string;
  enterprisePaceMs: number;
  port: number;
  dbPath: string;
  syncCron: string;
  syncTz: string;
  intradaySyncMinutes: number;
  backfillStart: string | null;
  backfillEmptyStreak: number;
  hourlyBackfillDays: number;
  demoMode: boolean;
  webDistPath: string;
  otelIngestToken: string | null;
  otelMaxBodyBytes: number;
  orgTimezone: string;
  streakMode: StreakMode;
}

export function loadEnv(): Env {
  loadDotEnv();
  const p = schema.parse(process.env);
  const demoMode = p.DEMO_MODE !== 0 || p.DATA_SOURCE === 'demo';
  // Data source resolution: demo wins; then an explicit DATA_SOURCE override
  // (validated against the keys it needs); then a claude.ai Enterprise
  // Analytics key (ADMIN_API_KEY becomes optional); then the Console Admin API
  // key; with no key at all the OTLP push receiver is the data source —
  // keyless boot is valid.
  let dataSource: DataSourceDto;
  if (demoMode) {
    dataSource = 'demo';
  } else if (p.DATA_SOURCE !== undefined) {
    if (p.DATA_SOURCE === 'console' && !p.ADMIN_API_KEY) {
      throw new Error('DATA_SOURCE=console requires ADMIN_API_KEY');
    }
    if (p.DATA_SOURCE === 'enterprise' && !p.ENTERPRISE_ANALYTICS_KEY) {
      throw new Error('DATA_SOURCE=enterprise requires ENTERPRISE_ANALYTICS_KEY');
    }
    dataSource = p.DATA_SOURCE;
  } else if (p.ENTERPRISE_ANALYTICS_KEY) {
    dataSource = 'enterprise';
  } else if (p.ADMIN_API_KEY) {
    dataSource = 'console';
  } else {
    dataSource = 'telemetry';
  }
  if (dataSource === 'telemetry' && !p.OTEL_INGEST_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      'warning: telemetry mode without OTEL_INGEST_TOKEN — the OTLP receiver accepts unauthenticated POSTs; set OTEL_INGEST_TOKEN outside trusted networks',
    );
    if (p.OTEL_MAX_BODY_MB > 8) {
      // eslint-disable-next-line no-console
      console.warn(
        `warning: OTEL_MAX_BODY_MB=${p.OTEL_MAX_BODY_MB} on an unauthenticated receiver — anyone who can reach it can make the server parse ${p.OTEL_MAX_BODY_MB} MiB of JSON per request`,
      );
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: p.ORG_TIMEZONE });
  } catch {
    throw new Error(`ORG_TIMEZONE is not a valid IANA zone: ${p.ORG_TIMEZONE}`);
  }
  return {
    dataSource,
    privacyMode: p.PRIVACY_MODE,
    adminApiKey: p.ADMIN_API_KEY ?? null,
    enterpriseAnalyticsKey: p.ENTERPRISE_ANALYTICS_KEY ?? null,
    enterpriseApiBase: p.ENTERPRISE_API_BASE,
    enterprisePaceMs: p.ENTERPRISE_PACE_MS,
    port: p.PORT,
    dbPath: resolveFromRepoRoot(p.DB_PATH),
    syncCron: p.SYNC_CRON,
    syncTz: p.SYNC_TZ,
    intradaySyncMinutes: p.INTRADAY_SYNC_MINUTES,
    backfillStart: p.BACKFILL_START ?? null,
    backfillEmptyStreak: p.BACKFILL_EMPTY_STREAK,
    hourlyBackfillDays: p.HOURLY_BACKFILL_DAYS,
    demoMode,
    webDistPath: resolveFromRepoRoot(p.WEB_DIST_PATH),
    otelIngestToken: p.OTEL_INGEST_TOKEN ?? null,
    otelMaxBodyBytes: p.OTEL_MAX_BODY_MB * 1024 * 1024,
    orgTimezone: p.ORG_TIMEZONE,
    streakMode: p.STREAK_MODE,
  };
}
