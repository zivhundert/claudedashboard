import { RELEASE_NOTES } from '@dash/shared';
import { Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/utils';

/** "What's new" — the shared release-notes list, newest first, current version highlighted. */
export function ReleaseNotesDialog({
  open,
  onOpenChange,
  currentVersion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentVersion: string | undefined;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={
        <span className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent" aria-hidden="true" />
          What’s new
        </span>
      }
      className="w-[min(94vw,560px)]"
    >
      <ol className="space-y-4">
        {RELEASE_NOTES.map((n) => {
          const current = n.version === currentVersion;
          return (
            <li key={n.version} className={cn('rounded-xl border p-3.5', current ? 'border-accent/40 bg-accent/[0.06]' : 'border-border')}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <span className="font-mono text-sm font-semibold">v{n.version}</span>
                {current && (
                  <span className="rounded-full bg-accent/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-accent">
                    current
                  </span>
                )}
                <span className="ml-auto text-[11px] text-muted">{n.date}</span>
              </div>
              <ul className="space-y-1 text-[12.5px] leading-relaxed">
                {n.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </Modal>
  );
}
