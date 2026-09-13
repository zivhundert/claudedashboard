/**
 * What the AI coach has cost so far, from the append-only generation ledger,
 * priced with the $/MTok rates in Settings. Works whether or not the coach
 * is configured right now — past spend is still past spend.
 */
import { priceGeneration, type AppSettings, type CoachUsageResponse, type CoachUsageWindowKey } from '@dash/shared';
import type { Repos } from '../repos';

const WINDOWS: Array<{ key: CoachUsageWindowKey; label: string; days: number | null }> = [
  { key: 'today', label: 'Today', days: 1 },
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
];

export function coachUsage(repos: Repos, settings: AppSettings, now = Date.now()): CoachUsageResponse {
  const pricing = {
    inputUsdPerMTok: settings.aiCoachPriceInputUsdPerMTok,
    outputUsdPerMTok: settings.aiCoachPriceOutputUsdPerMTok,
    cacheReadUsdPerMTok: settings.aiCoachPriceCacheReadUsdPerMTok,
  };
  let lastGeneratedAt: string | null = null;
  const windows = WINDOWS.map((w) => {
    // "today" = the current UTC day; rolling windows count back from now
    const since =
      w.days === null
        ? null
        : w.key === 'today'
          ? new Date(now).toISOString().slice(0, 10) + 'T00:00:00.000Z'
          : new Date(now - w.days * 86_400_000).toISOString();
    const row = repos.aiRecs.usageSince(since);
    const usage = {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
    };
    if (w.key === 'all') lastGeneratedAt = row.last_generated_at;
    return {
      key: w.key,
      label: w.label,
      since,
      generations: row.generations,
      ...usage,
      estimatedUsd: Math.round(priceGeneration(usage, pricing) * 10_000) / 10_000,
    };
  });
  return { windows, pricing, lastGeneratedAt };
}
