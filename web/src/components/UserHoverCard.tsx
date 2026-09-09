import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { LeaderboardEntry } from '@dash/shared';
import { Avatar } from '@/components/Avatar';
import { CountryFlag } from '@/components/CountryFlag';
import { SegmentChip } from '@/components/SegmentChip';
import { fmtCost, fmtNumber, fmtPct, fmtScore, fmtSigned } from '@/lib/format';

export function profilePath(entry: LeaderboardEntry): string {
  return `/user/${encodeURIComponent(entry.user.email ?? String(entry.user.id))}`;
}

/** Mini profile on hover: segment, composite, three stats, profile link. */
export function UserHoverCard({ entry, children }: { entry: LeaderboardEntry; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  const enter = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), 250);
  };
  const leave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 120);
  };

  const netLines = entry.metrics.linesAdded - entry.metrics.linesRemoved;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <span onMouseEnter={enter} onMouseLeave={leave} className="inline-flex min-w-0">
          {children}
        </span>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="card pop-in z-50 w-64 p-3 shadow-2xl"
        >
          <div className="flex items-center gap-2.5">
            <Avatar name={entry.user.name} email={entry.user.email} size={36} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold">{entry.user.name}</span>
                <CountryFlag code={entry.user.country} />
              </div>
              <div className="truncate text-[11px] text-muted">
                {entry.user.teamName ?? 'No team'}
              </div>
            </div>
            <div className="ml-auto text-right">
              <div className="hero-gradient text-lg font-bold">{fmtScore(entry.scores.composite)}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted">score</div>
            </div>
          </div>
          <div className="mt-2">
            <SegmentChip tier={entry.segment} />
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-border pt-2.5 text-center">
            <div>
              <div className="text-sm font-semibold">{fmtNumber(entry.metrics.sessions)}</div>
              <div className="text-[10px] text-muted">sessions</div>
            </div>
            <div>
              <div className="text-sm font-semibold">{fmtSigned(netLines)}</div>
              <div className="text-[10px] text-muted">net lines</div>
            </div>
            <div>
              <div className="text-sm font-semibold">{fmtPct(entry.metrics.acceptanceRate)}</div>
              <div className="text-[10px] text-muted">acceptance</div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-[11px]">
            <span className="text-muted">{fmtCost(entry.metrics.costCents)} spend</span>
            <Link to={profilePath(entry)} className="font-medium text-accent hover:underline">
              View profile →
            </Link>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
