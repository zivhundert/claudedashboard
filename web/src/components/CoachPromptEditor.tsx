/**
 * Settings → AI coach prompt. Admins edit the coaching guidance (persona,
 * rules, scoring explanations); the output contract the parser depends on is
 * shown read-only and always appended server-side. Saving needs the server's
 * ADMIN_PASSWORD (sent as a header, kept only in component state) and clears
 * every cached coaching note so the new prompt shows on the next visit.
 */
import { useEffect, useState } from 'react';
import { KeyRound, RotateCcw, Save, Sparkles } from 'lucide-react';
import { useCoachPrompt, useSaveCoachPrompt } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { relativeDateTime } from '@/lib/format';
import { toast } from '@/state/toast';
import { ErrorCard } from '@/components/ErrorCard';
import { Skeleton } from '@/components/Skeleton';
import { Button, Field, InfoPopover, inputCls } from '@/components/ui';
import { cn } from '@/lib/utils';

export function CoachPromptEditor() {
  const q = useCoachPrompt();
  const save = useSaveCoachPrompt();
  const [draft, setDraft] = useState('');
  const [password, setPassword] = useState('');
  const [showContract, setShowContract] = useState(false);

  // seed the editor from the server once; keep the user's edits afterwards
  useEffect(() => {
    if (q.data) setDraft(q.data.effectiveGuidance);
  }, [q.data]);

  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.error) return <ErrorCard error={q.error} onRetry={() => void q.refetch()} compact />;
  if (!q.data) return null;
  const info = q.data;

  const dirty = draft.trim() !== info.effectiveGuidance.trim();
  const isDefault = info.customGuidance === null;
  const canSubmit = password.length > 0 && !save.isPending && info.adminConfigured;

  const submit = (guidance: string | null) =>
    save.mutate(
      { guidance, password },
      {
        onSuccess: (saved) => {
          setDraft(saved.effectiveGuidance);
          toast(
            guidance === null ? 'Built-in prompt restored' : 'Coach prompt saved',
            'success',
            'Cached coaching notes were cleared — the next profile view uses the new prompt.',
          );
        },
        onError: (e) => {
          if (e instanceof ApiError && e.status === 401) toast('Wrong admin password', 'error');
          else if (e instanceof ApiError && e.status === 403) toast('Admin password not configured', 'error', 'Set ADMIN_PASSWORD on the server and restart.');
          else toast('Could not save the prompt', 'error', e instanceof Error ? e.message : undefined);
        },
      },
    );

  return (
    <section className="card space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
          <Sparkles size={13} className="text-accent" /> AI coach prompt
        </h2>
        <InfoPopover metricKey="aiCoach" />
        <span
          className={cn(
            'ml-auto rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wide',
            isDefault ? 'border-border text-muted' : 'border-accent/40 bg-accent/10 text-accent',
          )}
        >
          {isDefault ? 'built-in prompt' : `custom · saved ${info.updatedAt ? relativeDateTime(info.updatedAt) : ''}`}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted">
        This is the guidance Claude reads before writing a person’s recommendations: who it is, the rules, how the
        scores work. Edit it to change tone, priorities or house practices. The output format below is locked and
        always appended, so the card keeps working whatever you write.
        {!info.enabled && (
          <span className="text-warn"> The AI coach is currently off (no Foundry key), so the prompt is stored but unused.</span>
        )}
      </p>

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={18}
        className={cn(inputCls, 'min-h-[18rem] resize-y font-mono text-[11.5px] leading-relaxed')}
        aria-label="Coach guidance"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span>{draft.length.toLocaleString('en-US')} characters · ≈ {Math.round(draft.length / 4).toLocaleString('en-US')} tokens</span>
        {dirty && <span className="text-warn">unsaved changes</span>}
        <button type="button" onClick={() => setShowContract((v) => !v)} className="ml-auto underline decoration-dotted underline-offset-2 hover:text-fg">
          {showContract ? 'Hide' : 'Show'} the locked output contract
        </button>
      </div>
      {showContract && (
        <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-bg/60 p-3 font-mono text-[11px] leading-relaxed text-muted">
          {info.outputContract}
        </pre>
      )}

      <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field
          label="Admin password"
          hint={info.adminConfigured ? 'Required to save or reset. Not stored in the browser.' : 'ADMIN_PASSWORD is not set on the server — saving is disabled.'}
        >
          <div className="relative">
            <KeyRound size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!info.adminConfigured}
              className={cn(inputCls, 'pl-8')}
              placeholder="••••••"
            />
          </div>
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setDraft(info.effectiveGuidance)} disabled={!dirty}>
            Discard edits
          </Button>
          <Button onClick={() => submit(null)} disabled={!canSubmit || isDefault} title="Go back to the built-in prompt">
            <RotateCcw size={12} /> Reset to built-in
          </Button>
          <Button variant="primary" onClick={() => submit(draft)} disabled={!canSubmit || !dirty || draft.trim().length < 40}>
            <Save size={12} /> {save.isPending ? 'Saving…' : 'Save prompt'}
          </Button>
        </div>
      </div>
    </section>
  );
}
