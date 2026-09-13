import { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { DEFAULT_SETTINGS, type AppSettings } from '@dash/shared';
import { useSaveSettings, useSettings } from '@/lib/queries';
import { usePrefsStore } from '@/state/prefs';
import { toast } from '@/state/toast';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/Skeleton';
import { TelemetryPolicyDialog } from '@/components/TelemetryPolicyDialog';
import { CoachPromptEditor } from '@/components/CoachPromptEditor';
import { Button, Field, InfoPopover, inputCls } from '@/components/ui';

export default function AdminSettings() {
  const settingsQ = useSettings();
  const save = useSaveSettings();
  const resetRoi = usePrefsStore((s) => s.resetRoi);
  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [policyOpen, setPolicyOpen] = useState(false);

  useEffect(() => {
    if (settingsQ.data) setForm(settingsQ.data);
  }, [settingsQ.data]);

  if (settingsQ.isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (settingsQ.error) {
    return <ErrorCard error={settingsQ.error} onRetry={() => void settingsQ.refetch()} />;
  }

  const num = (key: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  const submit = () => {
    save.mutate(form, {
      onSuccess: (saved) => {
        resetRoi(saved);
        toast('Settings saved', 'success', 'Local ROI assumptions were updated to match.');
      },
      onError: (e) => toast('Could not save settings', 'error', e instanceof Error ? e.message : undefined),
    });
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-xs text-muted">
          Server-wide defaults. The business-value assumptions also apply locally — anyone can
          tweak them per-browser from the ROI card on the Overview page.
        </p>
      </header>

      <section className="card space-y-4 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">Display</h2>
        <Field
          label="Display timezone"
          hint="Set by ORG_TIMEZONE on the server — daily buckets are keyed by this zone, so it cannot change from here."
        >
          <input value={form.displayTimezone} readOnly disabled className={inputCls} />
        </Field>

        <h2 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Business value
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Lines / minute" hint="Hand-written pace">
            <input type="number" min={0.1} step={0.5} value={form.linesPerMinute} onChange={num('linesPerMinute')} className={inputCls} />
          </Field>
          <Field label="Hourly rate ($)">
            <input type="number" min={1} value={form.hourlyRateUsd} onChange={num('hourlyRateUsd')} className={inputCls} />
          </Field>
          <Field label="Seat cost ($/mo)">
            <input type="number" min={0} value={form.seatCostUsdMonthly} onChange={num('seatCostUsdMonthly')} className={inputCls} />
          </Field>
        </div>

        <h2 className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted">
          Insight thresholds
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Inactive after (days)" hint="Flags users as inactive">
            <input type="number" min={1} value={form.inactiveDays} onChange={num('inactiveDays')} className={inputCls} />
          </Field>
          <Field label="Declining drop (%)" hint="Sessions drop vs prior 14d">
            <input type="number" min={1} max={100} value={form.decliningPct} onChange={num('decliningPct')} className={inputCls} />
          </Field>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <Button onClick={() => setForm(DEFAULT_SETTINGS)}>
            <RotateCcw size={12} /> Reset to defaults
          </Button>
          <Button variant="primary" onClick={submit} disabled={save.isPending}>
            <Save size={12} /> {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        </div>
      </section>

      <section className="card space-y-2 p-5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">
            Telemetry transparency
          </h2>
          <InfoPopover metricKey="whatsCollected" />
        </div>
        <p className="text-xs leading-relaxed text-muted">
          The dashboard ingests Claude Code OpenTelemetry events under an explicit keep / drop /
          redact policy. The panel below renders the exact policy object the server executes —
          prompt and response content are never collected.
        </p>
        <Button onClick={() => setPolicyOpen(true)}>What&apos;s collected</Button>
        <TelemetryPolicyDialog open={policyOpen} onOpenChange={setPolicyOpen} />
      </section>

      <CoachPromptEditor />
    </div>
  );
}
