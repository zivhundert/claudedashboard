import { useState } from 'react';
import { useRangeParams } from '@/hooks/useRangeParams';
import { useMcp } from '@/lib/queries';
import { ChartPage, HiddenChartChips } from '@/components/ChartCard';
import { ErrorCard } from '@/components/ErrorCard';
import { BreakdownDrawer, type BreakdownTarget } from '@/components/BreakdownDrawer';
import { McpKpis, McpServersCard, McpToolsCard, McpTrendCard } from '@/components/McpCards';
import { TelemetrySetupCard } from '@/components/TelemetrySetupCard';
import { WhatsCollectedLink } from '@/components/TelemetryPolicyDialog';

export default function OrgMcp() {
  const { from, to, gran, teamId } = useRangeParams();
  const mcpQ = useMcp({ from, to, teamId });
  const [drill, setDrill] = useState<BreakdownTarget | null>(null);

  const mcp = mcpQ.data;
  const noData = !!mcp && !mcp.hasData;

  return (
    <ChartPage pageId="mcp">
      <div className="grid grid-cols-12 gap-4">
        {mcpQ.error ? (
          <div className="col-span-12">
            <ErrorCard error={mcpQ.error} onRetry={() => void mcpQ.refetch()} />
          </div>
        ) : (
          <>
            {noData && (
              <TelemetrySetupCard blurb="This view is powered by Claude Code’s OpenTelemetry events — every MCP server and tool your org reaches through Claude Code." />
            )}

            <McpKpis mcp={mcp} loading={mcpQ.isLoading} noData={noData} />

            <McpServersCard rows={mcp?.servers ?? []} isLoading={mcpQ.isLoading} noData={noData} onDrill={setDrill} />

            <McpToolsCard rows={mcp?.tools ?? []} isLoading={mcpQ.isLoading} noData={noData} onDrill={setDrill} />

            <McpTrendCard rows={mcp?.daily ?? []} gran={gran} isLoading={mcpQ.isLoading} noData={noData} />

            <div className="col-span-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
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
