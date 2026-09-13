/**
 * Data-source modes and the capability matrix that gates UI features.
 * One pure function so server (serving /api/capabilities) and any consumer
 * agree on exactly what each mode can show.
 */

export type DataSourceDto = 'demo' | 'telemetry' | 'console' | 'enterprise';
export type PrivacyMode = 'full' | 'balanced' | 'minimal';

export interface Capabilities {
  /** usage_daily/usage_daily_models are filled → overview, leaderboard, profiles */
  coreUsage: boolean;
  /** usage_hourly is filled → heatmaps + night/early scoring shares */
  hourlyActivity: boolean;
  /** what the cost figures mean */
  costs: 'billed' | 'estimated' | 'none';
  /** invoice-grade Costs page sections (cost_daily) */
  invoiceCosts: boolean;
  /** API-key inventory + per-key usage */
  apiKeys: boolean;
  /** service-tier / context-window slices */
  dimensions: boolean;
  /** an authoritative seat denominator exists (roster or org summaries) */
  seatCounts: boolean;
  /** an authoritative member list exists (vs observed-only users) */
  roster: boolean;
  terminalMix: boolean;
  /** customer/subscription tier charts */
  tierMix: boolean;
  webSearchCounts: boolean;
  /** OTel receiver is the primary/live feed */
  liveTelemetry: boolean;
  /** activity/reliability/governance/ecosystem endpoints have a data source */
  telemetryPacks: boolean;
  /** history predating install can exist */
  backfill: boolean;
  /** the AI coach card: a Foundry key is configured (the server flips this on at runtime) */
  aiRecommendations: boolean;
}

/**
 * AI coach runtime status. `enabled` mirrors capabilities.aiRecommendations;
 * the rest lets the UI and operators see WHAT answers and whether the boot
 * probe (one cheap request) reached it.
 */
export interface AiCoachStatus {
  /** a key is configured AND the Settings toggle is on — the card shows */
  enabled: boolean;
  /** a key is configured (the toggle may still be off) */
  configured: boolean;
  /** deployment name / proxy model alias, e.g. "claude-opus-5" or "gpt-5.6-luna" */
  model: string | null;
  /** human name of the provider, e.g. "Claude on Microsoft Foundry" or "GPT-5.6 via LiteLLM" */
  providerLabel: string | null;
  /** null = not probed yet */
  reachable: boolean | null;
  /** classified message of the last failed probe/generation; null when healthy */
  lastError: string | null;
  /** ISO time of the last probe or generation outcome */
  checkedAt: string | null;
}

export interface CapabilitiesResponse {
  dataSource: DataSourceDto;
  capabilities: Capabilities;
  privacyMode: PrivacyMode;
  /** Running server's product version (root package.json), e.g. "1.0.0". */
  version: string;
  aiCoach: AiCoachStatus;
}

export const AI_COACH_OFF: AiCoachStatus = {
  enabled: false,
  configured: false,
  model: null,
  providerLabel: null,
  reachable: null,
  lastError: null,
  checkedAt: null,
};

/**
 * Error codes the recommendations routes answer with (body `{ error, message }`):
 *   404 no_metrics_for_range — the person exists but has no metrics snapshot for the range
 *   404 user_not_found       — only when the :idOrEmail resolves to nobody
 *   404 ai_disabled          — no key configured, or turned off in Settings
 *   400 range_too_short      — fewer than COACH_MIN_RANGE_DAYS calendar days requested
 *   429 rate_limited         — Regenerate too soon (Retry-After set)
 *   503 model_not_deployed | auth_failed | unreachable — the endpoint is misconfigured or down
 *   502 upstream_rate_limited | bad_request | upstream_error | bad_answer — the endpoint failed this call
 */
export type AiCoachErrorCode =
  | 'no_metrics_for_range'
  | 'user_not_found'
  | 'ai_disabled'
  | 'range_too_short'
  | 'rate_limited'
  | 'model_not_deployed'
  | 'auth_failed'
  | 'unreachable'
  | 'upstream_rate_limited'
  | 'bad_request'
  | 'upstream_error'
  | 'bad_answer';

export function capabilitiesFor(dataSource: DataSourceDto): Capabilities {
  switch (dataSource) {
    case 'demo':
      return {
        coreUsage: true,
        hourlyActivity: true,
        costs: 'estimated',
        invoiceCosts: true,
        apiKeys: true,
        dimensions: true,
        seatCounts: true,
        roster: true,
        terminalMix: true,
        tierMix: true,
        webSearchCounts: true,
        liveTelemetry: false,
        telemetryPacks: true,
        backfill: true,
        aiRecommendations: false,
      };
    case 'telemetry':
      return {
        coreUsage: true,
        hourlyActivity: true,
        costs: 'estimated',
        invoiceCosts: false,
        apiKeys: false,
        dimensions: false,
        seatCounts: false,
        roster: false,
        terminalMix: true,
        tierMix: false,
        webSearchCounts: false,
        liveTelemetry: true,
        telemetryPacks: true,
        backfill: false,
        aiRecommendations: false,
      };
    case 'console':
      return {
        coreUsage: true,
        hourlyActivity: true,
        costs: 'billed',
        invoiceCosts: true,
        apiKeys: true,
        dimensions: true,
        seatCounts: true,
        roster: true,
        terminalMix: true,
        tierMix: true,
        webSearchCounts: true,
        liveTelemetry: false,
        // server flips this true when otel events have actually been ingested
        telemetryPacks: false,
        backfill: true,
        aiRecommendations: false,
      };
    case 'enterprise':
      return {
        coreUsage: true,
        hourlyActivity: true,
        costs: 'billed',
        invoiceCosts: true,
        apiKeys: false,
        dimensions: false,
        seatCounts: true,
        roster: false,
        terminalMix: false,
        tierMix: false,
        webSearchCounts: true,
        liveTelemetry: false,
        telemetryPacks: false,
        backfill: true,
        aiRecommendations: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Telemetry privacy policy (served by GET /api/telemetry-policy; the exact
// policy object the ingest path executes — transparency by construction)
// ---------------------------------------------------------------------------

export type AttrAction = 'keep' | 'drop' | 'redact';

export interface EventPolicy {
  /** short event name, e.g. 'tool_result' (claude_code. prefix stripped) */
  event: string;
  /** per-attribute action; attributes not listed get defaultAction */
  attrs: Record<string, AttrAction>;
  defaultAction: AttrAction;
  /** plain-language line for the transparency UI */
  description: string;
}

export interface TelemetryPolicyResponse {
  mode: PrivacyMode;
  events: EventPolicy[];
  /** plain-language caveats, e.g. "prompt content is never collected" */
  notes: string[];
}
