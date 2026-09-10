import type {
  ActivityResponse,
  AdoptionResponse,
  ApiKeysResponse,
  AppSettings,
  BreakdownDimension,
  BreakdownResponse,
  CapabilitiesResponse,
  CostsResponse,
  DimensionsResponse,
  EcosystemResponse,
  EntityDetailResponse,
  EntityKind,
  GovernanceResponse,
  Granularity,
  HeatmapResponse,
  InsightsResponse,
  LeaderboardResponse,
  McpResponse,
  OverviewResponse,
  ReliabilityResponse,
  SkillsResponse,
  SyncJobType,
  SyncLogsResponse,
  SyncStatusResponse,
  TeamDto,
  TeamsResponse,
  TeamsSummaryResponse,
  TelemetryPolicyResponse,
  TimeseriesResponse,
  UserProfileResponse,
  UsersResponse,
} from '@dash/shared';

export interface RangeQ {
  from?: string;
  to?: string;
  teamId?: string | number | undefined;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'Network error — is the backend running?');
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === 'object') {
        const rec = body as Record<string, unknown>;
        const candidate = rec['error'] ?? rec['message'];
        if (typeof candidate === 'string' && candidate.length > 0) msg = candidate;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

const json = (body: unknown): RequestInit => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  overview: (q: RangeQ & { gran?: Granularity }) =>
    request<OverviewResponse>(
      `/api/overview${qs({ from: q.from, to: q.to, teamId: q.teamId, gran: q.gran })}`,
    ),

  leaderboard: (q: RangeQ) =>
    request<LeaderboardResponse>(`/api/leaderboard${qs({ from: q.from, to: q.to, teamId: q.teamId })}`),

  users: () => request<UsersResponse>('/api/users'),

  userProfile: (idOrEmail: string, q: RangeQ) =>
    request<UserProfileResponse>(
      `/api/users/${encodeURIComponent(idOrEmail)}/profile${qs({ from: q.from, to: q.to })}`,
    ),

  timeseries: (idOrEmail: string, q: RangeQ & { split: 'none' | 'terminal' | 'model' }) =>
    request<TimeseriesResponse>(
      `/api/users/${encodeURIComponent(idOrEmail)}/timeseries${qs({
        from: q.from,
        to: q.to,
        split: q.split,
      })}`,
    ),

  heatmap: (q: RangeQ & { userId?: number | undefined }) =>
    request<HeatmapResponse>(
      `/api/heatmap${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  teams: () => request<TeamsResponse>('/api/teams'),

  createTeam: (body: { name: string; color: string; leadUserId: number | null }) =>
    request<TeamDto>('/api/teams', { method: 'POST', ...json(body) }),

  updateTeam: (id: number, body: { name: string; color: string; leadUserId: number | null }) =>
    request<TeamDto>(`/api/teams/${id}`, { method: 'PUT', ...json(body) }),

  deleteTeam: (id: number) => request<unknown>(`/api/teams/${id}`, { method: 'DELETE' }),

  setUserTeam: (userId: number, teamId: number | null) =>
    request<unknown>(`/api/users/${userId}/team`, { method: 'PUT', ...json({ teamId }) }),

  setUserCountry: (userId: number, country: string | null) =>
    request<unknown>(`/api/users/${userId}/country`, { method: 'PUT', ...json({ country }) }),

  teamsSummary: (q: RangeQ) =>
    request<TeamsSummaryResponse>(`/api/teams/summary${qs({ from: q.from, to: q.to })}`),

  insights: (q: RangeQ) =>
    request<InsightsResponse>(`/api/insights${qs({ from: q.from, to: q.to, teamId: q.teamId })}`),

  costs: (q: Pick<RangeQ, 'from' | 'to'>) =>
    request<CostsResponse>(`/api/costs${qs({ from: q.from, to: q.to })}`),

  apiKeys: (q: Pick<RangeQ, 'from' | 'to'>) =>
    request<ApiKeysResponse>(`/api/api-keys${qs({ from: q.from, to: q.to })}`),

  dimensions: (q: Pick<RangeQ, 'from' | 'to'>) =>
    request<DimensionsResponse>(`/api/dimensions${qs({ from: q.from, to: q.to })}`),

  /** org-level; the endpoint ignores teamId */
  adoption: (q: Pick<RangeQ, 'from' | 'to'>) =>
    request<AdoptionResponse>(`/api/adoption${qs({ from: q.from, to: q.to })}`),

  /** skills / subagents / tools telemetry; userId scopes to one person */
  skills: (q: RangeQ & { userId?: number | undefined }) =>
    request<SkillsResponse>(
      `/api/skills${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  /** data-source capability matrix that gates UI features */
  capabilities: () => request<CapabilitiesResponse>('/api/capabilities'),

  /** the exact telemetry ingest policy the server executes (transparency panel) */
  telemetryPolicy: () => request<TelemetryPolicyResponse>('/api/telemetry-policy'),

  /** telemetry packs — engaged time / prompts / sessions / live hourly */
  telemetryActivity: (q: RangeQ & { userId?: number | undefined }) =>
    request<ActivityResponse>(
      `/api/telemetry/activity${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  /** telemetry packs — API errors / refusals / latency / compactions */
  telemetryReliability: (q: RangeQ & { userId?: number | undefined }) =>
    request<ReliabilityResponse>(
      `/api/telemetry/reliability${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  /** telemetry packs — tool-decision sources / permission modes */
  telemetryGovernance: (q: RangeQ & { userId?: number | undefined }) =>
    request<GovernanceResponse>(
      `/api/telemetry/governance${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  /** telemetry packs — MCP servers / plugins / versions / model mix */
  entityDetail: (kind: EntityKind, name: string, q: RangeQ) =>
    request<EntityDetailResponse>(`/api/entity${qs({ kind, name, from: q.from, to: q.to, teamId: q.teamId })}`),

  breakdown: (dimension: BreakdownDimension, entity: string, q: RangeQ) =>
    request<BreakdownResponse>(
      `/api/breakdown${qs({ dimension, entity, from: q.from, to: q.to, teamId: q.teamId })}`,
    ),

  telemetryEcosystem: (q: RangeQ & { userId?: number | undefined }) =>
    request<EcosystemResponse>(
      `/api/telemetry/ecosystem${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  /** telemetry packs — MCP servers / tools / daily trend */
  telemetryMcp: (q: RangeQ & { userId?: number | undefined }) =>
    request<McpResponse>(
      `/api/telemetry/mcp${qs({ from: q.from, to: q.to, teamId: q.teamId, userId: q.userId })}`,
    ),

  syncStatus: () => request<SyncStatusResponse>('/api/sync/status'),

  /** Live sync log tail — pass the last seq seen to get only newer lines. */
  syncLogs: (after: number, runId?: number) =>
    request<SyncLogsResponse>(`/api/sync/logs${qs({ after, runId })}`),

  runSync: (type: SyncJobType) => request<unknown>('/api/sync/run', { method: 'POST', ...json({ type }) }),

  settings: () => request<AppSettings>('/api/settings'),

  saveSettings: (s: AppSettings) => request<AppSettings>('/api/settings', { method: 'PUT', ...json(s) }),
};
