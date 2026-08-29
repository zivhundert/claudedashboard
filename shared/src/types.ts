/**
 * Shared API contract between @dash/server and @dash/web.
 * All dates are 'YYYY-MM-DD' UTC days unless suffixed Iso (full ISO-8601 UTC).
 * All costs are cents (USD) as numbers; divide by 100 and round only at display.
 */

import { DEFAULT_SCORE_TARGETS, type ScoreTargets } from './scoring/targets.js';

export type ActorType = 'user' | 'api_key';
export type Granularity = 'day' | 'week' | 'month';
export type SegmentTier = 'starter' | 'explorer' | 'producer' | 'champion';

export type ToolName = 'edit' | 'multi_edit' | 'write' | 'notebook';
export const TOOL_NAMES: ToolName[] = ['edit', 'multi_edit', 'write', 'notebook'];

export type BadgeId =
  | 'pr_machine'
  | 'ship_it'
  | 'cache_master'
  | 'night_owl'
  | 'early_bird'
  | 'streak_bronze'
  | 'streak_silver'
  | 'streak_gold'
  | 'streak_kryptonite'
  | 'polyglot'
  | 'marathon'
  | 'high_output'
  | 'efficient'
  | 'high_acceptance'
  | 'experimenting'
  | 'skill_smith'
  | 'plan_first'
  | 'dream_builder'
  | 'well_connected'
  | 'orchestrator'
  | 'deep_diver';

// ---------------------------------------------------------------------------
// Core entities
// ---------------------------------------------------------------------------

export interface TeamDto {
  id: number;
  name: string;
  color: string; // hex
  leadUserId: number | null;
  memberCount: number;
}

export interface UserDto {
  id: number;
  actorType: ActorType;
  /** null for api_key actors */
  email: string | null;
  /** null for user actors */
  apiKeyName: string | null;
  name: string;
  /** roster role: user|claude_code_user|developer|billing|admin; null if never rostered */
  role: string | null;
  addedAt: string | null; // ISO
  inRoster: boolean;
  teamId: number | null;
  teamName: string | null;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  /** billing path last observed in usage: 'api' | 'subscription'; null = unknown */
  customerType: string | null;
  /** plan for subscription users (pro/max/team/enterprise); null for api/unknown */
  subscriptionType: string | null;
}

export interface TokenTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface DateRange {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// GET /api/overview
// ---------------------------------------------------------------------------

export interface OverviewKpis {
  /** users (actor_type=user) with >=1 session in range */
  activeUsers: number;
  /** in_roster user actors */
  rosteredUsers: number;
  /** activeRosteredUsers / rosteredUsers * 100 */
  adoptionPct: number;
  sessions: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  /** accepted / (accepted+rejected) across all tools; null when no events */
  acceptanceRate: number | null;
  /** includes api_key actors (real spend) */
  costCents: number;
  tokens: TokenTotals;
  /** cacheRead / (cacheRead + input); null when no tokens */
  cacheRatio: number | null;
}

export interface OverviewDailyPoint {
  date: string;
  sessions: number;
  activeUsers: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  costCents: number;
}

export interface ModelUsage {
  model: string;
  tokens: TokenTotals;
  costCents: number;
}

export interface ModelDailyCost {
  date: string;
  model: string;
  costCents: number;
}

export interface TerminalMixEntry {
  terminalType: string;
  sessions: number;
}

export interface OverviewResponse {
  range: DateRange;
  /** dates whose data is still incomplete (today UTC, and today-1 near midnight) */
  partialDates: string[];
  kpis: OverviewKpis;
  /** same-length previous period, for delta chips */
  prevKpis: OverviewKpis;
  daily: OverviewDailyPoint[];
  models: ModelUsage[];
  modelDailyCost: ModelDailyCost[];
  terminalMix: TerminalMixEntry[];
}

// ---------------------------------------------------------------------------
// Scoring (computed in shared/scoring, executed server-side)
// ---------------------------------------------------------------------------

export interface AxisScores {
  adoption: number;
  impact: number;
  efficiency: number;
  trust: number;
  /** null when activeDays < 3 (insufficient data) */
  composite: number | null;
  /** tool events < 20 → trust halved, shown with grey confidence dot */
  trustLowConfidence: boolean;
  /** sessions < 10 → efficiency halved */
  efficiencyLowConfidence: boolean;
}

export interface BadgeStatus {
  id: BadgeId;
  earned: boolean;
  /** 0..1 progress toward earning (1 when earned) */
  progress: number;
  /** short human string of current value vs threshold, e.g. "3 / 5 PRs" */
  detail: string;
}

export interface StreakInfo {
  /** active days in a row ending today or yesterday, trailing 90d, on the org's STREAK_MODE */
  current: number;
  best: number;
}

// ---------------------------------------------------------------------------
// GET /api/leaderboard  (also backs team member table)
// ---------------------------------------------------------------------------

export interface LeaderboardMetrics {
  sessions: number;
  activeDays: number;
  /** Sun–Thu days in the selected range */
  workdays: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  toolAccepted: number;
  toolRejected: number;
  /** null when no tool events */
  acceptanceRate: number | null;
  perTool: Record<ToolName, { accepted: number; rejected: number }>;
  costCents: number;
  tokens: TokenTotals;
  cacheRatio: number | null;
  /** distinct models with >=5% of personal total tokens */
  significantModels: number;
}

export interface LeaderboardEntry {
  user: UserDto;
  metrics: LeaderboardMetrics;
  scores: AxisScores;
  segment: SegmentTier;
  badges: BadgeStatus[];
  streak: StreakInfo;
  /** last 14 days of sessions, oldest first */
  sparkline: number[];
  /** sessions last-14d vs prior-14d, percent; null when prior period ~0 */
  trendDeltaPct: number | null;
  lastActiveDate: string | null;
}

export interface LeaderboardResponse {
  range: DateRange;
  entries: LeaderboardEntry[];
  /** org medians for radar overlay */
  orgMedianScores: { adoption: number; impact: number; efficiency: number; trust: number };
}

// ---------------------------------------------------------------------------
// GET /api/users, /api/users/:id, /api/users/:id/timeseries
// ---------------------------------------------------------------------------

export interface UsersResponse {
  users: UserDto[];
}

export interface CalendarDay {
  date: string;
  sessions: number;
  netLines: number;
  costCents: number;
}

export interface UserProfileResponse {
  user: UserDto;
  range: DateRange;
  entry: LeaderboardEntry;
  models: ModelUsage[];
  /** trailing 12 months regardless of range filter */
  calendar: CalendarDay[];
  terminalMix: TerminalMixEntry[];
}

export interface TimeseriesPoint {
  date: string;
  /** terminal_type or model when split is requested, else null */
  key: string | null;
  sessions: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  toolAccepted: number;
  toolRejected: number;
  costCents: number;
}

export interface TimeseriesResponse {
  range: DateRange;
  split: 'none' | 'terminal' | 'model';
  points: TimeseriesPoint[];
}

// ---------------------------------------------------------------------------
// GET /api/heatmap — raw UTC hours; client converts to Asia/Jerusalem then bins
// ---------------------------------------------------------------------------

export interface HeatmapHour {
  /** 'YYYY-MM-DDTHH:00:00Z' */
  hourUtc: string;
  tokens: number;
  activeUsers: number;
}

export interface HeatmapResponse {
  range: DateRange;
  hours: HeatmapHour[];
  /** heatmap covers OAuth-authenticated Claude Code traffic only */
  coverageNote: string;
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface TeamsResponse {
  teams: TeamDto[];
}

export interface TeamSummary {
  team: TeamDto;
  activeMembers: number;
  activePct: number;
  sessions: number;
  sessionsPerActive: number | null;
  costCents: number;
  costPerActiveCents: number | null;
  linesAdded: number;
  netLines: number;
  acceptanceRate: number | null;
  avgScores: { adoption: number; impact: number; efficiency: number; trust: number; composite: number };
  segmentCounts: Record<SegmentTier, number>;
}

export interface TeamsSummaryResponse {
  range: DateRange;
  teams: TeamSummary[];
  /** users with no team, for the editor + an "Unassigned" bucket */
  unassignedCount: number;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type InsightKind =
  | 'celebrate'
  | 'inactive'
  | 'never_activated'
  | 'declining'
  | 'low_acceptance'
  | 'cache_leak'
  | 'adoption_gap';

export interface InsightCard {
  id: string;
  kind: InsightKind;
  severity: 'positive' | 'info' | 'warn';
  title: string;
  body: string;
  /** users this insight is about (for avatars / links) */
  userIds: number[];
  /** top champions who could help, when relevant */
  championUserIds: number[];
  teamId: number | null;
}

export interface InsightsResponse {
  range: DateRange;
  cards: InsightCard[];
  nonAdopters: Array<{
    user: UserDto;
    daysIdle: number | null; // null = never active
    lastActiveDate: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SyncJobType = 'backfill' | 'daily' | 'hourly' | 'roster' | 'nightly';

export interface SyncRunInfo {
  id: number;
  jobType: SyncJobType;
  trigger: 'cron' | 'manual' | 'startup';
  status: 'running' | 'success' | 'error' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  rowsWritten: number;
  progress: {
    currentDate?: string;
    daysDone?: number;
    emptyStreak?: number;
    earliestFound?: string;
  } | null;
  error: string | null;
}

export interface SyncStatusResponse {
  running: SyncRunInfo | null;
  lastRuns: Partial<Record<SyncJobType, SyncRunInfo>>;
  watermarks: Record<string, string>;
  demoMode: boolean;
  /** ISO of most recent successful data write, drives the header freshness pill */
  dataFreshAt: string | null;
}

export type SyncLogLevel = 'debug' | 'info' | 'warn' | 'error';

/** One line in the live sync log window. `source`: 'sync' | 'api' | 'step'. */
export interface SyncLogLine {
  seq: number;
  runId: number;
  ts: string; // ISO
  level: SyncLogLevel;
  source: string;
  message: string;
}

export interface SyncLogsResponse {
  /** lines with seq > the requested `after`, oldest first */
  lines: SyncLogLine[];
  /** highest seq now seen — send back as the next `after` cursor */
  nextSeq: number;
  /** the run these lines belong to (active run, else most recent) */
  runId: number | null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  displayTimezone: string; // default 'Asia/Jerusalem'
  /** business-value defaults (client may override locally) */
  linesPerMinute: number; // default 2
  hourlyRateUsd: number; // default 60
  seatCostUsdMonthly: number; // default 60
  /** insight thresholds */
  inactiveDays: number; // default 7
  decliningPct: number; // default 40 (drop vs prior 14d)
  /** fixed scoring targets (see scoring/targets.ts); partial overrides merge over defaults */
  scoreTargets: ScoreTargets;
}

export const DEFAULT_SETTINGS: AppSettings = {
  displayTimezone: 'Asia/Jerusalem',
  linesPerMinute: 2,
  hourlyRateUsd: 60,
  seatCostUsdMonthly: 60,
  inactiveDays: 7,
  decliningPct: 40,
  scoreTargets: DEFAULT_SCORE_TARGETS,
};

// ---------------------------------------------------------------------------
// GET /api/costs — invoice-grade costs from cost_report (org-level; the API
// has no per-user cost dimension). Estimated = claude_code model estimates.
// ---------------------------------------------------------------------------

export type CostType = 'tokens' | 'web_search' | 'code_execution' | 'session_usage' | 'other';

export interface CostsResponse {
  range: DateRange;
  /** actual daily spend split by cost type */
  actualDaily: Array<{ date: string; byCostType: Partial<Record<CostType, number>>; totalCents: number }>;
  estimatedVsActual: Array<{ date: string; estimatedCents: number; actualCents: number }>;
  byWorkspace: Array<{ workspaceId: string | null; workspaceName: string; totalCents: number }>;
  byModel: Array<{ model: string; totalCents: number }>;
  totals: {
    actualCents: number;
    estimatedCents: number;
    webSearchCents: number;
    codeExecutionCents: number;
  };
  /** true when cost_report has never been synced (e.g. demo mode before seed) */
  hasData: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/api-keys — key inventory + per-key token usage (governance).
// Cost report has no per-key dimension, so keys show tokens + share, not $.
// ---------------------------------------------------------------------------

export interface ApiKeyRow {
  id: string;
  name: string;
  status: string; // active | inactive | archived | expired
  createdAt: string | null;
  createdByName: string | null;
  workspaceName: string | null;
  partialKeyHint: string | null;
  tokens: TokenTotals;
  /** share of all api-key token volume in range, 0..1 */
  tokenShare: number;
  lastActiveDate: string | null;
}

export interface ApiKeysResponse {
  range: DateRange;
  keys: ApiKeyRow[];
}

// ---------------------------------------------------------------------------
// GET /api/dimensions — org-level consumption efficiency slices from
// usage_report/messages (service tier / context window), plus per-user-capable
// extras: web search counts and api-vs-subscription mix from claude_code data.
// ---------------------------------------------------------------------------

export interface DimensionSlice {
  key: string; // e.g. 'batch', 'standard', '0-200k', '200k-1M'
  tokens: TokenTotals;
}

export interface DimensionsResponse {
  range: DateRange;
  serviceTier: DimensionSlice[];
  contextWindow: DimensionSlice[];
  /** sessions + estimated cost by customer_type (api | subscription) */
  customerType: Array<{ key: string; sessions: number; costCents: number }>;
  webSearch: {
    totalRequests: number;
    topUsers: Array<{ userId: number; name: string; requests: number }>;
  };
  hasData: boolean;
}

// ---------------------------------------------------------------------------
// GET /api/adoption — rolling actives + org-wide activity calendar
// (derived entirely from usage_daily; no new upstream calls)
// ---------------------------------------------------------------------------

export interface AdoptionResponse {
  range: DateRange;
  /** per day in range: distinct active users that day / trailing 7d / trailing 30d */
  series: Array<{ date: string; dau: number; wau: number; mau: number }>;
  rosteredUsers: number;
  /** org-wide trailing 365 days */
  calendar: CalendarDay[];
}

// ---------------------------------------------------------------------------
// GET /api/skills — skills / subagents / all-tools analytics from Claude
// Code's OpenTelemetry events, ingested at POST /otel/v1/logs. Optional
// ?userId= scopes skills/agents/tools to one person (profile card).
// ---------------------------------------------------------------------------

export interface SkillUsageRow {
  skillName: string;
  invocations: number;
  /** distinct users who invoked it */
  users: number;
  /** cost attributed via api_request events carrying skill.name */
  costCents: number;
  /** invocation_trigger split */
  userSlash: number;
  proactive: number;
  nested: number;
}

export interface AgentUsageRow {
  subagentType: string;
  invocations: number;
  users: number;
  /** success / (success + failure) from tool_result; null when unknown */
  successRate: number | null;
  costCents: number;
}

export interface ToolUsageRow {
  toolName: string;
  uses: number;
  /** accept/reject from tool_decision (0 when the tool has no decision flow) */
  accepted: number;
  rejected: number;
  successRate: number | null;
}

export interface UserSkillRow {
  userId: number;
  name: string;
  email: string | null;
  skillInvocations: number;
  distinctSkills: number;
  agentInvocations: number;
  topSkill: string | null;
}

export interface SkillsResponse {
  range: DateRange;
  /** false until any OTel event has been ingested in range */
  hasData: boolean;
  totals: {
    skillInvocations: number;
    distinctSkills: number;
    agentInvocations: number;
    activeSkillUsers: number;
    skillCostCents: number;
    agentCostCents: number;
  };
  skills: SkillUsageRow[];
  agents: AgentUsageRow[];
  tools: ToolUsageRow[];
  /** per-user rollup (empty when userId scope is applied) */
  users: UserSkillRow[];
  ingest: { eventsIngested: number; lastEventAt: string | null };
}

// ---------------------------------------------------------------------------
// Telemetry packs — GET /api/telemetry/{activity,reliability,governance,
// ecosystem}. All accept from/to (+ optional teamId, userId like /api/skills).
// Data source: OTel events/metrics rollup tables (migration 006).
// ---------------------------------------------------------------------------

export interface ActivityResponse {
  range: DateRange;
  hasData: boolean;
  totals: {
    activeUserSeconds: number;
    activeCliSeconds: number;
    prompts: number;
    sessions: number;
    /** wall-clock session span (includes idle); null when no sessions tracked */
    avgSessionMs: number | null;
    medianSessionMs: number | null;
  };
  daily: Array<{
    date: string;
    activeUserSeconds: number;
    activeCliSeconds: number;
    prompts: number;
    sessions: number;
  }>;
  /** live granular activity from otel_activity_hourly (UTC hours) */
  hourly: Array<{ hourUtc: string; prompts: number; apiRequests: number; activeUsers: number }>;
  perUser: Array<{
    userId: number;
    name: string;
    email: string | null;
    activeUserSeconds: number;
    prompts: number;
    sessions: number;
    avgSessionMs: number | null;
  }>;
}

export interface ReliabilityResponse {
  range: DateRange;
  hasData: boolean;
  totals: {
    apiRequests: number;
    apiErrors: number;
    refusals: number;
    compactions: number;
    internalErrors: number;
    /** errors / (requests + errors); null when denominator is 0 */
    errorRate: number | null;
    avgRequestMs: number | null;
  };
  byModel: Array<{
    model: string;
    apiRequests: number;
    apiErrors: number;
    errorRate: number | null;
    refusals: number;
    avgRequestMs: number | null;
  }>;
  daily: Array<{ date: string; apiRequests: number; apiErrors: number; refusals: number }>;
  errorStatuses: { e429: number; e5xx: number; other: number };
}

export type DecisionSource =
  | 'config'
  | 'hook'
  | 'user_permanent'
  | 'user_temporary'
  | 'user_abort'
  | 'user_reject';

export interface GovernanceResponse {
  range: DateRange;
  hasData: boolean;
  decisionSources: Record<DecisionSource, number>;
  permissionModes: Array<{ mode: string; changes: number; users: number }>;
  perUser: Array<{
    userId: number;
    name: string;
    email: string | null;
    /** (config + hook + user_permanent) / all decisions; null when none */
    autoApprovedShare: number | null;
    rejects: number;
    aborts: number;
    modeChanges: number;
  }>;
}

export interface EcosystemResponse {
  range: DateRange;
  hasData: boolean;
  mcpServers: Array<{
    serverName: string;
    toolCalls: number;
    toolFailures: number;
    tokens: number;
    costCents: number;
    connections: number;
    connectionFailures: number;
    users: number;
  }>;
  plugins: Array<{ pluginName: string; installs: number; loads: number; users: number }>;
  versions: Array<{ appVersion: string; users: number }>;
  modelMix: Array<{ model: string; speed: string; effort: string; tokens: number; costCents: number }>;
}

export interface McpToolUsageRow {
  /** full telemetry name, 'mcp__server__tool' */
  toolName: string;
  uses: number;
  users: number;
  successRate: number | null;
  /** denominator behind successRate — calls with a known success/failure outcome, ≤ uses */
  judged: number;
  accepted: number;
  rejected: number;
}

export interface McpResponse {
  range: DateRange;
  hasData: boolean;
  servers: EcosystemResponse['mcpServers'];
  tools: McpToolUsageRow[];
  daily: Array<{
    date: string;
    toolCalls: number;
    toolFailures: number;
    connections: number;
    connectionFailures: number;
  }>;
}

// ---------------------------------------------------------------------------
// GET /api/breakdown — "who are the users" behind any aggregate count
// ---------------------------------------------------------------------------

/** Allowlisted drill-down dimensions; each maps to one pack/core table. */
export const BREAKDOWN_DIMENSIONS = [
  'skill',
  'agent',
  'tool',
  'mcp',
  'plugin',
  'version',
  'model-reliability',
  'permission-mode',
  'active-users',
] as const;
export type BreakdownDimension = (typeof BREAKDOWN_DIMENSIONS)[number];

export interface BreakdownColumn {
  key: string;
  label: string;
  format: 'number' | 'cents' | 'pct';
}

export interface BreakdownUserRow {
  userId: number;
  name: string;
  email: string | null;
  teamId: number | null;
  /** keyed by BreakdownColumn.key */
  metrics: Record<string, number>;
  /** last day with activity in range (null for stateful dimensions like version) */
  lastDate: string | null;
}

export interface BreakdownResponse {
  dimension: BreakdownDimension;
  /** the entity drilled into ('' for entity-less dimensions like active-users) */
  entity: string;
  range: { from: string; to: string };
  columns: BreakdownColumn[];
  /** sorted by the first column's metric, descending */
  rows: BreakdownUserRow[];
}

// ---------------------------------------------------------------------------
// Common query params (documented once; all analytics endpoints accept these)
// ---------------------------------------------------------------------------

export interface RangeQuery {
  from?: string; // YYYY-MM-DD inclusive, default: 30 days ago
  to?: string; // YYYY-MM-DD inclusive, default: today UTC
  teamId?: number;
  /** default 'user' — api_key pseudo-actors excluded from people metrics */
  actorType?: ActorType | 'all';
}
