import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings, BreakdownDimension, EntityKind, Granularity, SyncJobType, SyncLogLine } from '@dash/shared';
import { api, type RangeQ } from '@/lib/api';

const key = (q: RangeQ) => [q.from ?? null, q.to ?? null, q.teamId != null ? String(q.teamId) : null];

export function useOverview(q: RangeQ & { gran?: Granularity }) {
  return useQuery({
    queryKey: ['overview', q.gran ?? 'day', ...key(q)],
    queryFn: () => api.overview(q),
  });
}

export function useLeaderboard(q: RangeQ) {
  return useQuery({ queryKey: ['leaderboard', ...key(q)], queryFn: () => api.leaderboard(q) });
}

export function useUsers() {
  return useQuery({ queryKey: ['users'], queryFn: () => api.users() });
}

export function useUserProfile(idOrEmail: string | undefined, q: RangeQ) {
  return useQuery({
    queryKey: ['profile', idOrEmail ?? null, ...key(q)],
    queryFn: () => api.userProfile(idOrEmail ?? '', q),
    enabled: !!idOrEmail,
  });
}

export function useTimeseries(
  idOrEmail: string | undefined,
  q: RangeQ & { split: 'none' | 'terminal' | 'model' },
) {
  return useQuery({
    queryKey: ['timeseries', idOrEmail ?? null, q.split, ...key(q)],
    queryFn: () => api.timeseries(idOrEmail ?? '', q),
    enabled: !!idOrEmail,
  });
}

export function useHeatmap(q: RangeQ & { userId?: number | undefined }, enabled = true) {
  return useQuery({
    queryKey: ['heatmap', q.userId ?? null, ...key(q)],
    queryFn: () => api.heatmap(q),
    enabled,
  });
}

export function useTeams() {
  return useQuery({ queryKey: ['teams'], queryFn: () => api.teams() });
}

export function useTeamsSummary(q: RangeQ) {
  return useQuery({ queryKey: ['teams-summary', ...key(q)], queryFn: () => api.teamsSummary(q) });
}

export function useInsights(q: RangeQ) {
  return useQuery({ queryKey: ['insights', ...key(q)], queryFn: () => api.insights(q) });
}

const rangeKey = (q: Pick<RangeQ, 'from' | 'to'>) => [q.from ?? null, q.to ?? null];

export function useCosts(q: Pick<RangeQ, 'from' | 'to'>) {
  return useQuery({ queryKey: ['costs', ...rangeKey(q)], queryFn: () => api.costs(q) });
}

export function useApiKeys(q: Pick<RangeQ, 'from' | 'to'>, enabled = true) {
  return useQuery({ queryKey: ['api-keys', ...rangeKey(q)], queryFn: () => api.apiKeys(q), enabled });
}

export function useDimensions(q: Pick<RangeQ, 'from' | 'to'>, enabled = true) {
  return useQuery({ queryKey: ['dimensions', ...rangeKey(q)], queryFn: () => api.dimensions(q), enabled });
}

/** Org-level adoption pulse + activity calendar (endpoint ignores teamId). */
export function useAdoption(q: Pick<RangeQ, 'from' | 'to'>) {
  return useQuery({ queryKey: ['adoption', ...rangeKey(q)], queryFn: () => api.adoption(q) });
}

/** Skills / subagents / tools telemetry; pass userId to scope to one person. */
export function useSkills(q: RangeQ & { userId?: number | undefined }, enabled = true) {
  return useQuery({
    queryKey: ['skills', ...key(q), q.userId ?? null],
    queryFn: () => api.skills(q),
    enabled,
  });
}

/**
 * Data-source capability matrix — decided at server startup, so it never goes
 * stale within a session. Retries forever so a slow backend can't permanently
 * hide gated navigation.
 */
export function useCapabilities() {
  return useQuery({
    queryKey: ['capabilities'],
    queryFn: () => api.capabilities(),
    staleTime: Infinity,
    retry: true,
  });
}

/** The exact ingest policy the server executes (transparency dialog). */
export function useTelemetryPolicy(enabled = true) {
  return useQuery({
    queryKey: ['telemetry-policy'],
    queryFn: () => api.telemetryPolicy(),
    staleTime: Infinity,
    enabled,
  });
}

const packKey = (name: string, q: RangeQ & { userId?: number | undefined }) => [
  name,
  ...key(q),
  q.userId ?? null,
];

/** Telemetry pack: engaged time / prompts / sessions. `refetchMs` powers the live panel. */
export function useActivity(
  q: RangeQ & { userId?: number | undefined },
  opts?: { refetchMs?: number; enabled?: boolean },
) {
  return useQuery({
    queryKey: packKey('telemetry-activity', q),
    queryFn: () => api.telemetryActivity(q),
    enabled: opts?.enabled ?? true,
    ...(opts?.refetchMs ? { refetchInterval: opts.refetchMs } : {}),
  });
}

/** Telemetry pack: API errors / refusals / latency / compactions. */
export function useReliability(q: RangeQ & { userId?: number | undefined }, enabled = true) {
  return useQuery({
    queryKey: packKey('telemetry-reliability', q),
    queryFn: () => api.telemetryReliability(q),
    enabled,
  });
}

/** Telemetry pack: tool-decision sources / permission modes. */
export function useGovernance(q: RangeQ & { userId?: number | undefined }, enabled = true) {
  return useQuery({
    queryKey: packKey('telemetry-governance', q),
    queryFn: () => api.telemetryGovernance(q),
    enabled,
  });
}

/** Telemetry pack: MCP servers / plugins / versions / model mix. */
export function useEcosystem(q: RangeQ & { userId?: number | undefined }, enabled = true) {
  return useQuery({
    queryKey: packKey('telemetry-ecosystem', q),
    queryFn: () => api.telemetryEcosystem(q),
    enabled,
  });
}

/** Telemetry pack: MCP servers / tools / daily trend. */
export function useMcp(q: RangeQ & { userId?: number | undefined }, enabled = true) {
  return useQuery({
    queryKey: packKey('telemetry-mcp', q),
    queryFn: () => api.telemetryMcp(q),
    enabled,
  });
}

export function useEntityDetail(kind: EntityKind | null, name: string, q: RangeQ) {
  return useQuery({
    queryKey: ['entity', kind, name, q.from, q.to, q.teamId ?? null],
    queryFn: () => api.entityDetail(kind as EntityKind, name, q),
    enabled: kind !== null && name !== '',
  });
}

export function useBreakdown(
  dimension: BreakdownDimension | null,
  entity: string,
  q: RangeQ,
) {
  return useQuery({
    queryKey: ['breakdown', dimension, entity, q.from, q.to, q.teamId ?? null],
    queryFn: () => api.breakdown(dimension as BreakdownDimension, entity, q),
    enabled: dimension !== null,
  });
}

/** Query keys that hold synced usage data and go stale when a sync lands. */
const DATA_KEYS = [
  'overview',
  'leaderboard',
  'heatmap',
  'insights',
  'teams-summary',
  'profile',
  'timeseries',
  'costs',
  'api-keys',
  'dimensions',
  'adoption',
  'skills',
  'telemetry-activity',
  'telemetry-reliability',
  'telemetry-governance',
  'telemetry-ecosystem',
  'telemetry-mcp',
];

export function useSyncStatus(refetchMs = 60_000) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.syncStatus(),
    refetchInterval: refetchMs,
    staleTime: 30_000,
  });
  const freshAt = q.data?.dataFreshAt ?? null;
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // Skip the initial load; only invalidate when a completed sync moves dataFreshAt.
    if (prev.current !== undefined && freshAt !== null && freshAt !== prev.current) {
      for (const k of DATA_KEYS) void qc.invalidateQueries({ queryKey: [k] });
    }
    prev.current = freshAt;
  }, [freshAt, qc]);
  return q;
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.settings() });
}

const MAX_CLIENT_LOG_LINES = 5000;

/**
 * Live sync log tail. While `enabled`, polls `/api/sync/logs` every second and
 * accumulates new lines by cursor (react-query replaces data per fetch, which
 * doesn't fit an append-only stream). Starting from seq 0 replays the server's
 * retained buffer (current + last run), so opening it after a failure shows
 * that run's full log. Capped client-side to bound memory.
 */
export function useSyncLogTail(enabled: boolean): { lines: SyncLogLine[]; runId: number | null } {
  const [lines, setLines] = useState<SyncLogLine[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    seqRef.current = 0;
    setLines([]);

    const poll = async () => {
      try {
        const res = await api.syncLogs(seqRef.current);
        if (cancelled) return;
        setRunId(res.runId);
        if (res.lines.length > 0) {
          seqRef.current = res.nextSeq;
          setLines((prev) => {
            const next = prev.concat(res.lines);
            return next.length > MAX_CLIENT_LOG_LINES ? next.slice(-MAX_CLIENT_LOG_LINES) : next;
          });
        }
      } catch {
        /* transient network/HTTP error — retry next tick */
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [enabled]);

  return { lines, runId };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidator() {
  const qc = useQueryClient();
  return (keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

const TEAM_KEYS = ['teams', 'teams-summary', 'users', 'leaderboard', 'overview', 'insights', 'profile', 'heatmap'];

export function useCreateTeam() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (body: { name: string; color: string; leadUserId: number | null }) =>
      api.createTeam(body),
    onSuccess: () => invalidate(TEAM_KEYS),
  });
}

export function useUpdateTeam() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; name: string; color: string; leadUserId: number | null }) =>
      api.updateTeam(id, body),
    onSuccess: () => invalidate(TEAM_KEYS),
  });
}

export function useDeleteTeam() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: (id: number) => api.deleteTeam(id),
    onSuccess: () => invalidate(TEAM_KEYS),
  });
}

export function useSetUserTeam() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ userId, teamId }: { userId: number; teamId: number | null }) =>
      api.setUserTeam(userId, teamId),
    onSuccess: () => invalidate(TEAM_KEYS),
  });
}

export function useSetUserCountry() {
  const invalidate = useInvalidator();
  return useMutation({
    mutationFn: ({ userId, country }: { userId: number; country: string | null }) =>
      api.setUserCountry(userId, country),
    onSuccess: () => invalidate(TEAM_KEYS),
  });
}

export function useRunSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (type: SyncJobType) => api.runSync(type),
    onSettled: () => qc.invalidateQueries({ queryKey: ['sync-status'] }),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: AppSettings) => api.saveSettings(s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}
