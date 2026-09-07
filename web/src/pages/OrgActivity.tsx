import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ActivityResponse } from '@dash/shared';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useActivity } from '@/lib/queries';
import { fmtDurationMs, fmtDurationSec, fmtNumber } from '@/lib/format';
import { ChartCard, ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { ActivityKpis, EngagedTimeTrend, PromptsSessionsTrend, SessionLengthCard } from '@/components/ActivityCharts';
import { LiveTodayCard, fmtLiveHour } from '@/components/LiveTodayCard';
import { BreakdownDrawer, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Avatar } from '@/components/Avatar';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';
import { cn } from '@/lib/utils';

/** Live panel refresh cadence. */
const LIVE_REFETCH_MS = 60_000;

export default function OrgActivity() {
  const { from, to, gran, teamId } = useRangeParams();
  const activityQ = useActivity({ from, to, teamId }, { refetchMs: LIVE_REFETCH_MS });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const activity = activityQ.data;
  const noData = !!activity && !activity.hasData;

  return (
    <ChartPage pageId="activity">
      <div className="grid grid-cols-12 gap-4">
        {activityQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={activityQ.error} onRetry={() => void activityQ.refetch()} />
          </div>
        ) : (
          <>
            {noData && (
              <TelemetrySetupCard blurb="This view measures genuine engagement — hands-on developer time, Claude-working time, prompts, and sessions — from Claude Code’s OpenTelemetry metrics." />
            )}

            <ActivityKpis activity={activity} loading={activityQ.isLoading} noData={noData} />

            <ChartCard
              title="Engaged time"
              chartId="engaged-time-trend"
              metricKey="activeTime"
              subtitle="Developer hands-on vs Claude-working time, stacked"
              className="col-span-12 lg:col-span-7"
              isLoading={activityQ.isLoading}
              isEmpty={noData || (!!activity && activity.daily.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : undefined}
            >
              {(ref) => <EngagedTimeTrend instanceRef={ref} rows={activity?.daily ?? []} gran={gran} />}
            </ChartCard>

            <ChartCard
              title="Prompts & sessions"
              chartId="prompts-sessions-trend"
              metricKey="promptCadence"
              subtitle="Prompts (bars) and sessions (line)"
              className="col-span-12 lg:col-span-5"
              isLoading={activityQ.isLoading}
              isEmpty={noData || (!!activity && activity.daily.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : undefined}
            >
              {(ref) => <PromptsSessionsTrend instanceRef={ref} rows={activity?.daily ?? []} gran={gran} />}
            </ChartCard>

            <LiveTodayCard
              activity={activity}
              isLoading={activityQ.isLoading}
              noData={noData}
              onHourClick={(h) =>
                setDrill({ dimension: 'active-hour', entity: h.hourUtc, title: `Active · ${fmtLiveHour(h.hourUtc)}` })
              }
            />

            <SessionLengthCard activity={activity} isLoading={activityQ.isLoading} noData={noData} />

            <ChartCard
              title="Per person"
              chartId="activity-per-user"
              metricKey="activeTime"
              infoExtra="Only people whose machines ship OpenTelemetry events appear here."
              className="col-span-12"
              noExport
              isEmpty={noData || (!!activity && activity.perUser.length === 0)}
              emptyText={noData ? 'Waiting for telemetry events' : 'No per-user telemetry in this range'}
            >
              {activityQ.isLoading ? (
                <TableSkeleton rows={5} cols={5} />
              ) : (
                <PerUserTable rows={activity?.perUser ?? []} />
              )}
            </ChartCard>

            <div className="col-span-12">
              <WhatsCollectedLink />
            </div>
          </>
        )}

        <HiddenChartChips />
      </div>
      <BreakdownDrawer target={drill} onClose={() => setDrill(null)} range={{ from, to, teamId }} />
    </ChartPage>
  );
}

// ---------------------------------------------------------------------------
// Per-user table
// ---------------------------------------------------------------------------

function PerUserTable({ rows }: { rows: ActivityResponse['perUser'] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.activeUserSeconds - a.activeUserSeconds),
    [rows],
  );
  const maxEngaged = sorted[0]?.activeUserSeconds ?? 0;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {['Member', 'Engaged time', '', 'Prompts', 'Sessions', 'Avg session'].map((h, i) => (
              <th
                key={`${h}-${i}`}
                className={cn(
                  'whitespace-nowrap px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted',
                  i >= 3 && 'text-right',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((u) => (
            <tr key={u.userId} className="border-b border-border/60 transition-colors hover:bg-fg/[0.025]">
              <td className="px-2.5 py-2">
                <Link
                  to={`/user/${encodeURIComponent(u.email ?? String(u.userId))}`}
                  className="group inline-flex items-center gap-2.5"
                >
                  <Avatar name={u.name} email={u.email} size={26} />
                  <span className="truncate text-[13px] font-medium group-hover:text-accent group-hover:underline">
                    {u.name}
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-[13px] font-medium">
                {fmtDurationSec(u.activeUserSeconds)}
              </td>
              <td className="w-40 px-2.5 py-2">
                <span className="block h-[5px] w-full overflow-hidden rounded-full bg-fg/10">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{
                      width: `${maxEngaged > 0 ? Math.max(2, Math.round((u.activeUserSeconds / maxEngaged) * 100)) : 0}%`,
                    }}
                  />
                </span>
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.prompts)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtNumber(u.sessions)}
              </td>
              <td className="whitespace-nowrap px-2.5 py-2 text-right text-xs text-muted">
                {fmtDurationMs(u.avgSessionMs)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
