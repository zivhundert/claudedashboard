import { useEffect, useState } from 'react';
import { KeyRound, RotateCcw, Save, Sparkles } from 'lucide-react';
import { DEFAULT_SETTINGS, type AppSettings } from '@dash/shared';
import { useCapabilities, useCoachUsage, useSaveSettings, useSettings } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { fmtTokens, relativeDateTime } from '@/lib/format';
import { usePrefsStore } from '@/state/prefs';
import { toast } from '@/state/toast';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/Skeleton';
import { TelemetryPolicyDialog } from '@/components/TelemetryPolicyDialog';
import { CoachPromptEditor } from '@/components/CoachPromptEditor';
import { Button, Field, InfoPopover, Switch, inputCls } from '@/components/ui';
import { cn } from '@/lib/utils';

export default function AdminSettings() {
  const settingsQ = useSettings();
  const save = useSaveSettings();
  const resetRoi = usePrefsStore((s) => s.resetRoi);
  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');

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

  const saved = settingsQ.data;
  // Off → on is the privileged direction: the server demands the admin password.
  const turningCoachOn = form.aiCoachEnabled && saved?.aiCoachEnabled === false;

  const num = (key: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  const submit = () => {
    if (turningCoachOn && adminPassword.trim() === '') {
      toast('Admin password needed', 'info', 'Turning the AI coach back on requires the admin password.');
      return;
    }
    save.mutate(
      { settings: form, ...(turningCoachOn ? { adminPassword } : {}) },
      {
        onSuccess: (s) => {
          resetRoi(s);
          setAdminPassword('');
          toast('Settings saved', 'success', 'Local ROI assumptions were updated to match.');
        },
        onError: (e) => {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            toast('Could not turn the AI coach on', 'error', e.message);
          } else {
            toast('Could not save settings', 'error', e instanceof Error ? e.message : undefined);
          }
        },
      },
    );
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

      <AiCoachSection
        form={form}
        setForm={setForm}
        turningCoachOn={turningCoachOn}
        adminPassword={adminPassword}
        setAdminPassword={setAdminPassword}
        onSave={submit}
        saving={save.isPending}
      />

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

const usd = (n: number): string => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`);

function AiCoachSection({
  form,
  setForm,
  turningCoachOn,
  adminPassword,
  setAdminPassword,
  onSave,
  saving,
}: {
  form: AppSettings;
  setForm: React.Dispatch<React.SetStateAction<AppSettings>>;
  turningCoachOn: boolean;
  adminPassword: string;
  setAdminPassword: (v: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const caps = useCapabilities().data?.aiCoach;
  const usageQ = useCoachUsage();
  const price = (key: 'aiCoachPriceInputUsdPerMTok' | 'aiCoachPriceOutputUsdPerMTok' | 'aiCoachPriceCacheReadUsdPerMTok') =>
    (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  const status = !caps
    ? null
    : !caps.configured
      ? 'No FOUNDRY_API_KEY on the server — the switch has no effect until one is configured.'
      : caps.reachable === false
        ? `Configured (${caps.providerLabel} · ${caps.model}) but UNREACHABLE: ${caps.lastError ?? 'unknown error'}`
        : `${caps.providerLabel} · ${caps.model}${caps.reachable ? ' · reachable' : ''}`;

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-1.5">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          <Sparkles size={13} className="text-accent" /> AI coach
        </h2>
        <InfoPopover metricKey="aiCoach" />
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium">{form.aiCoachEnabled ? 'AI coach is on' : 'AI coach is off'}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Anyone can switch it off. Switching it back on asks for the admin password (the same one as the
            prompt editor below).
            {status && <span className={cn('block', caps?.reachable === false && 'text-warn')}>{status}</span>}
          </p>
        </div>
        <Switch checked={form.aiCoachEnabled} onCheckedChange={(v) => setForm((f) => ({ ...f, aiCoachEnabled: v }))} />
      </div>

      {turningCoachOn && (
        <Field label="Admin password" hint="Required to turn the coach back on. Not stored in the browser.">
          <div className="relative">
            <KeyRound size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="password"
              autoComplete="off"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className={cn(inputCls, 'pl-8')}
              placeholder="••••••"
            />
          </div>
        </Field>
      )}

      <h3 className="pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Model price ($ per million tokens)</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Input" hint="Cache writes are billed at this rate">
          <input type="number" min={0} step={0.01} value={form.aiCoachPriceInputUsdPerMTok} onChange={price('aiCoachPriceInputUsdPerMTok')} className={inputCls} />
        </Field>
        <Field label="Output">
          <input type="number" min={0} step={0.01} value={form.aiCoachPriceOutputUsdPerMTok} onChange={price('aiCoachPriceOutputUsdPerMTok')} className={inputCls} />
        </Field>
        <Field label="Cache read">
          <input type="number" min={0} step={0.01} value={form.aiCoachPriceCacheReadUsdPerMTok} onChange={price('aiCoachPriceCacheReadUsdPerMTok')} className={inputCls} />
        </Field>
      </div>

      <h3 className="pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Usage &amp; estimated cost</h3>
      {usageQ.isLoading ? (
        <Skeleton className="h-24" />
      ) : usageQ.error ? (
        <ErrorCard error={usageQ.error} compact onRetry={() => void usageQ.refetch()} />
      ) : usageQ.data ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10.5px] uppercase tracking-wide text-muted">
              <tr className="text-left">
                <th className="py-1 pr-3 font-medium">Window</th>
                <th className="py-1 pr-3 text-right font-medium">Generations</th>
                <th className="py-1 pr-3 text-right font-medium">Input</th>
                <th className="py-1 pr-3 text-right font-medium">Output</th>
                <th className="py-1 pr-3 text-right font-medium">Cache read</th>
                <th className="py-1 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {usageQ.data.windows.map((w) => (
                <tr key={w.key} className="border-t border-border tabular-nums">
                  <td className="py-1.5 pr-3">{w.label}</td>
                  <td className="py-1.5 pr-3 text-right">{w.generations.toLocaleString('en-US')}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtTokens(w.inputTokens + w.cacheWriteTokens)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtTokens(w.outputTokens)}</td>
                  <td className="py-1.5 pr-3 text-right">{fmtTokens(w.cacheReadTokens)}</td>
                  <td className="py-1.5 text-right font-semibold">{w.generations === 0 ? '—' : usd(w.estimatedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Priced with the saved rates (${usageQ.data.pricing.inputUsdPerMTok} / ${usageQ.data.pricing.outputUsdPerMTok} / $
            {usageQ.data.pricing.cacheReadUsdPerMTok} per M tokens). Token counts are what the endpoint reported; canned
            answers for people with no activity cost nothing and are not counted.
            {usageQ.data.lastGeneratedAt && <> Last generation {relativeDateTime(usageQ.data.lastGeneratedAt)}.</>}
          </p>
        </div>
      ) : null}

      <div className="flex items-center justify-end border-t border-border pt-4">
        <Button variant="primary" onClick={onSave} disabled={saving}>
          <Save size={12} /> {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </section>
  );
}
