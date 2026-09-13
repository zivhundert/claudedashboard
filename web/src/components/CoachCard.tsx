/**
 * The AI coach: 3–5 recommendations written by the configured model (Claude on
 * Microsoft Foundry, or whatever sits behind an Anthropic-compatible proxy —
 * /api/capabilities says which) from this person's numbers vs org medians and
 * score targets, plus a "where you stand" line and strengths. Renders nothing
 * at all unless the server reports the capability (a key is configured); a
 * misconfigured endpoint is shown IN the card, never hidden. Fetches its own
 * endpoint so the rest of the Personal page never waits on a model call.
 */
import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, RotateCw, Sparkles, ThumbsUp } from 'lucide-react';
import {
  evidenceLabel,
  formatEvidenceValue,
  getEvidenceValue,
  type Recommendation,
  type RecommendationsResponse,
  type ScoreAxis,
} from '@dash/shared';
import { useCapabilities, useRecommendations, useRegenerateRecommendations } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { relativeDateTime } from '@/lib/format';
import { usePersonaStore } from '@/state/persona';
import { toast } from '@/state/toast';
import { ChartCard } from '@/components/ChartCard';
import { SectionHeader } from '@/components/SectionHeader';
import { Skeleton } from '@/components/Skeleton';
import { Button, Tip } from '@/components/ui';
import { cn } from '@/lib/utils';

const AXIS_LABEL: Record<ScoreAxis, string> = {
  adoption: 'Adoption',
  impact: 'Impact',
  efficiency: 'Efficiency',
  trust: 'Trust',
};

const AXIS_CLASS: Record<ScoreAxis, string> = {
  adoption: 'border-accent/40 bg-accent/10 text-accent',
  impact: 'border-accent2/40 bg-accent2/10 text-accent2',
  efficiency: 'border-good/40 bg-good/10 text-good',
  trust: 'border-warn/40 bg-warn/10 text-warn',
};

export function CoachCard({
  idOrEmail,
  userName,
  profileEmail,
  from,
  to,
}: {
  idOrEmail: string;
  userName: string;
  profileEmail: string | null;
  from: string;
  to: string;
}) {
  const caps = useCapabilities().data;
  const enabled = caps?.capabilities.aiRecommendations === true;
  const q = useRecommendations(idOrEmail, { from, to }, enabled);
  const regen = useRegenerateRecommendations();
  const viewerEmail = usePersonaStore((s) => s.email);
  if (!enabled) return null;

  const data = q.data;
  const provider = caps?.aiCoach.providerLabel ?? 'the AI coach';
  const model = caps?.aiCoach.model ?? null;
  const isSelf = viewerEmail !== null && profileEmail !== null && viewerEmail === profileEmail;
  const firstName = userName.split(/[\s.]+/)[0] ?? userName;
  // Endpoint/config failures and "no metrics" are rendered inside the card
  // with a specific message; only unexpected errors fall to the generic ErrorCard.
  const coachError = q.error instanceof ApiError ? classifyCoachError(q.error) : null;

  const onRegenerate = () =>
    regen.mutate(
      { idOrEmail, from, to },
      {
        onSuccess: () => toast('Coaching notes refreshed', 'success'),
        onError: (e) => {
          if (e instanceof ApiError && e.status === 429) {
            const m = /(\d+) min/.exec(e.message);
            toast('Regenerate is limited', 'info', m ? `Try again in ${m[1]} min.` : 'Try again in a few minutes.');
          } else if (e instanceof ApiError && e.status === 503) {
            toast('AI coach misconfigured', 'error', e.message);
          } else {
            toast('Could not regenerate', 'error', e instanceof Error ? e.message : undefined);
          }
        },
      },
    );

  return (
    <>
      <SectionHeader title="Coach" hint="AI-generated from the numbers on this page" />
      <ChartCard
        title="AI coach"
        chartId="ai-coach"
        metricKey="aiCoach"
        subtitle={isSelf ? 'Personalised for you' : `Personalised for ${firstName}`}
        className="col-span-12"
        noExport
        isLoading={q.isLoading}
        error={coachError ? undefined : q.error}
        onRetry={() => void q.refetch()}
        actions={
          <Tip content={data?.cached ? `Cached ${relativeDateTime(data.generatedAt)} — ask ${provider} again` : `Ask ${provider} again`}>
            <span>
              <Button variant="ghost" onClick={onRegenerate} disabled={regen.isPending || q.isLoading} title="Regenerate">
                <RotateCw size={13} className={cn(regen.isPending && 'animate-spin')} />
                <span className="hidden sm:inline">Regenerate</span>
              </Button>
            </span>
          </Tip>
        }
      >
        {q.isLoading ? (
          <GeneratingSkeleton />
        ) : coachError ? (
          <CoachProblem kind={coachError} error={q.error as ApiError} provider={provider} model={model} onRetry={() => void q.refetch()} />
        ) : data ? (
          <CoachBody data={data} busy={regen.isPending} />
        ) : null}
      </ChartCard>
    </>
  );
}

type CoachProblemKind = 'misconfigured' | 'upstream' | 'no-metrics';

/** Which in-card state an API failure maps to; null = not a coach-specific failure. */
function classifyCoachError(err: ApiError): CoachProblemKind | null {
  if (err.code === 'no_metrics_for_range') return 'no-metrics';
  if (err.status === 503) return 'misconfigured';
  if (err.status === 502) return 'upstream';
  return null;
}

function CoachProblem({
  kind,
  error,
  provider,
  model,
  onRetry,
}: {
  kind: CoachProblemKind;
  error: ApiError;
  provider: string;
  model: string | null;
  onRetry: () => void;
}) {
  if (kind === 'no-metrics') {
    return (
      <div className="rounded-lg border border-border bg-fg/[0.03] px-3 py-3 text-xs text-muted">
        Not enough data for this range — no metrics were recorded for this person between the selected dates. Pick a
        wider range or come back after a few sessions.
      </div>
    );
  }
  const title = kind === 'misconfigured' ? 'AI coach misconfigured' : `${provider} could not answer`;
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/5 px-3 py-3 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" />
        <div className="min-w-0 space-y-1.5">
          <div className="font-semibold text-fg">
            {title}
            {error.code && <span className="ml-2 rounded border border-border px-1 py-px font-mono text-[10px] font-normal text-muted">{error.code}</span>}
          </div>
          <p className="break-words leading-relaxed text-muted">{error.message}</p>
          <p className="text-[11px] text-muted">
            {kind === 'misconfigured'
              ? `The server could not use ${provider}${model ? ` (${model})` : ''}. Check FOUNDRY_BASE_URL, FOUNDRY_API_KEY and FOUNDRY_MODEL on the server — the boot banner and /api/capabilities show the same reason.`
              : 'The endpoint is configured but this request failed. Retrying usually helps; if it keeps failing, check the server log.'}
          </p>
          <Button onClick={onRetry}>
            <RotateCw size={12} /> Try again
          </Button>
        </div>
      </div>
    </div>
  );
}

function GeneratingSkeleton() {
  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Sparkles size={13} className="animate-pulse text-accent" />
        Reading your numbers… the first time can take up to a minute.
      </div>
      <Skeleton className="h-4 w-3/4" />
      <div className="grid gap-3 lg:grid-cols-[1fr_2fr]">
        <Skeleton className="h-28" />
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    </div>
  );
}

function CoachBody({ data, busy }: { data: RecommendationsResponse; busy: boolean }) {
  return (
    <div className={cn('space-y-4 py-1 transition-opacity', busy && 'opacity-60')}>
      <p className="text-[13px] leading-relaxed">{data.standing}</p>

      {data.dataThin && (
        <div className="rounded-lg border border-border bg-fg/[0.03] px-3 py-2 text-[11.5px] text-muted">
          Not enough activity in this range to coach on properly — the notes below stay deliberately light.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Keep doing</div>
          {data.strengths.length === 0 ? (
            <p className="text-xs text-muted">Nothing stands out yet in this range.</p>
          ) : (
            data.strengths.map((s) => (
              <div key={s.title} className="rounded-lg border border-l-2 border-border border-l-good p-3">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-good/10 text-good">
                    <ThumbsUp size={12} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold leading-snug">{s.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{s.why}</p>
                    <EvidenceChips keys={s.evidence} data={data} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Try next</div>
          {data.recommendations.length === 0 ? (
            <p className="text-xs text-muted">No recommendations for this range.</p>
          ) : (
            <ol className="space-y-2">
              {data.recommendations.map((r, i) => (
                <RecommendationRow key={r.id} index={i + 1} rec={r} data={data} />
              ))}
            </ol>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-[10.5px] text-muted">
        <span>Generated {relativeDateTime(data.generatedAt)}</span>
        <span>·</span>
        <span className="font-mono">{data.model}</span>
        <span>·</span>
        <span>{data.disclosure}</span>
        {data.staleReason && <span className="basis-full text-warn">{data.staleReason}</span>}
      </div>
    </div>
  );
}

function RecommendationRow({ index, rec, data }: { index: number; rec: Recommendation; data: RecommendationsResponse }) {
  const [open, setOpen] = useState(index === 1);
  return (
    <li className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left"
      >
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold text-accent">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold leading-snug">{rec.title}</span>
            <span className={cn('rounded-full border px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wide', AXIS_CLASS[rec.expectedEffect.axis])}>
              {AXIS_LABEL[rec.expectedEffect.axis]}
            </span>
          </span>
          {!open && <span className="mt-0.5 block truncate text-xs text-muted">{rec.why}</span>}
        </span>
        <span className="mt-1 shrink-0 text-muted">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3 pl-[46px] text-xs leading-relaxed">
          <p>
            <span className="font-semibold text-fg">Why: </span>
            <span className="text-muted">{rec.why}</span>
          </p>
          <p>
            <span className="font-semibold text-fg">Try: </span>
            <span>{rec.tryThis}</span>
          </p>
          {rec.expectedEffect.note && (
            <p className="text-muted">
              <span className="font-semibold text-fg">Effect: </span>
              lifts {AXIS_LABEL[rec.expectedEffect.axis]} — {rec.expectedEffect.note}
            </p>
          )}
          <EvidenceChips keys={rec.evidence} data={data} />
        </div>
      )}
    </li>
  );
}

function EvidenceChips({ keys, data }: { keys: string[]; data: RecommendationsResponse }) {
  if (keys.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {keys.map((k) => {
        const value = getEvidenceValue(data.input, k);
        return (
          <Tip key={k} content={k}>
            <span className="inline-flex items-center gap-1 rounded border border-border bg-bg/60 px-1.5 py-px text-[10px] text-muted">
              {evidenceLabel(k)}
              <span className="font-semibold tabular-nums text-fg">{formatEvidenceValue(k, value)}</span>
            </span>
          </Tip>
        );
      })}
    </div>
  );
}
