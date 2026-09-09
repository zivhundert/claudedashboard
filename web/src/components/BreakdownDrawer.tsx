/**
 * The "who are the users" drill-down. Any aggregate user count in the app can
 * open this drawer: it fetches GET /api/breakdown for a (dimension, entity)
 * and lists the actual people with their per-entity metrics, each linking to
 * their profile. One component, wired everywhere a bare count used to be.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, UserX } from 'lucide-react';
import type { BreakdownDimension, BreakdownUserRow } from '@dash/shared';
import { useBreakdown } from '@/lib/queries';
import { fmtCost, fmtNumber, fmtPct, relativeIso } from '@/lib/format';
import { Avatar } from '@/components/Avatar';
import { TableSkeleton } from '@/components/Skeleton';
import { ErrorCard } from '@/components/ErrorCard';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface BreakdownTarget {
  dimension: BreakdownDimension;
  entity: string;
  /** drawer heading, e.g. "MCP server · jira" */
  title: string;
  /** overrides the page range — e.g. one clicked bucket of a trend chart */
  range?: { from: string; to: string };
}

interface BreakdownDrawerProps {
  target: BreakdownTarget | null;
  onClose: () => void;
  range: { from?: string; to?: string; teamId?: string | number | undefined };
}

const fmtByFormat = (value: number, format: 'number' | 'cents' | 'pct'): string =>
  format === 'cents' ? fmtCost(value) : format === 'pct' ? fmtPct(value) : fmtNumber(value);

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

export function BreakdownDrawer({ target, onClose, range }: BreakdownDrawerProps) {
  const effective = target?.range ? { ...range, from: target.range.from, to: target.range.to } : range;
  const q = useBreakdown(target?.dimension ?? null, target?.entity ?? '', effective);
  const data = q.data;
  const [showInactive, setShowInactive] = useState(true);

  const exportCsv = () => {
    if (!data || !target) return;
    const head = ['name', 'email', ...data.columns.map((c) => c.key), 'last_active'];
    const lines = data.rows.map((r) =>
      [
        csvEscape(r.name),
        csvEscape(r.email ?? ''),
        ...data.columns.map((c) => String(r.metrics[c.key] ?? 0)),
        r.lastDate ?? '',
      ].join(','),
    );
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${target.dimension}-${target.entity || 'all'}-users.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Sheet
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={
        <span className="flex items-center gap-2">
          <Users size={15} className="text-muted" aria-hidden="true" />
          {target?.title ?? ''}
        </span>
      }
    >
      {q.isLoading && <TableSkeleton rows={5} />}
      {q.error && <ErrorCard error={q.error} onRetry={() => void q.refetch()} />}
      {data && (
        <>
          <div className="mb-3 flex items-center justify-between text-xs text-muted">
            <span>
              {fmtNumber(data.rows.length)} {data.inactive ? 'active' : data.rows.length === 1 ? 'person' : 'people'}
              {data.inactive && ` · ${fmtNumber(data.inactive.length)} not active`} ·{' '}
              {data.range.from === data.range.to ? data.range.from : `${data.range.from} → ${data.range.to}`}
            </span>
            {data.rows.length > 0 && (
              <button
                type="button"
                onClick={exportCsv}
                className="rounded border border-border px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-fg"
              >
                Export CSV
              </button>
            )}
          </div>
          {data.rows.length === 0 ? (
            <p className="text-sm text-muted">
              {data.inactive ? 'Nobody was active in this period.' : 'No activity for this item in the selected range.'}
            </p>
          ) : (
            <div className="space-y-2">
              {data.rows.map((r) => (
                <BreakdownRow key={r.userId} row={r} columns={data.columns} />
              ))}
            </div>
          )}
          {data.inactive && (
            <section className="mt-5">
              <button
                type="button"
                onClick={() => setShowInactive((v) => !v)}
                aria-expanded={showInactive}
                className="mb-2 flex w-full items-center gap-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wider text-muted transition-colors hover:text-fg"
              >
                <UserX size={12} aria-hidden="true" />
                Not active ({fmtNumber(data.inactive.length)})
                <span className="ml-auto text-[10px] font-normal normal-case tracking-normal">
                  {showInactive ? 'hide' : 'show'}
                </span>
              </button>
              {showInactive &&
                (data.inactive.length === 0 ? (
                  <p className="text-xs text-muted">Everyone on the roster was active 🎉</p>
                ) : (
                  <div className="space-y-1">
                    {data.inactive.map((r) => (
                      <InactiveRow key={r.userId} row={r} />
                    ))}
                  </div>
                ))}
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}

function BreakdownRow({
  row,
  columns,
}: {
  row: BreakdownUserRow;
  columns: Array<{ key: string; label: string; format: 'number' | 'cents' | 'pct' }>;
}) {
  const profilePath = `/user/${encodeURIComponent(row.email ?? String(row.userId))}`;
  const metrics = useMemo(
    () => columns.filter((c) => (row.metrics[c.key] ?? 0) !== 0 || columns.length <= 2),
    [columns, row.metrics],
  );
  return (
    <Link
      to={profilePath}
      className="block rounded-lg border border-border bg-bg/50 p-3 transition-colors hover:border-accent/50"
    >
      <div className="flex items-center gap-2.5">
        <Avatar name={row.name} size={26} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.name}</div>
          {row.email && <div className="truncate text-[11px] text-muted">{row.email}</div>}
        </div>
        {row.lastDate && (
          <span className="shrink-0 text-[10.5px] text-muted">
            {relativeIso(row.lastDate)}
          </span>
        )}
      </div>
      {metrics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {metrics.map((c) => (
            <span key={c.key} className="text-[11px] text-muted">
              {c.label}:{' '}
              <span className="font-medium text-fg">
                {fmtByFormat(row.metrics[c.key] ?? 0, c.format)}
              </span>
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

/** Compact row for someone with no activity in the period; last seen from the roster. */
function InactiveRow({ row }: { row: BreakdownUserRow }) {
  const profilePath = `/user/${encodeURIComponent(row.email ?? String(row.userId))}`;
  return (
    <Link
      to={profilePath}
      className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-bg/30 px-3 py-2 opacity-80 transition-colors hover:border-accent/50 hover:opacity-100"
    >
      <Avatar name={row.name} size={22} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{row.name}</div>
        {row.email && <div className="truncate text-[10.5px] text-muted">{row.email}</div>}
      </div>
      <span className="shrink-0 text-[10.5px] text-muted">
        {row.lastDate ? `last seen ${relativeIso(row.lastDate)}` : 'never active'}
      </span>
    </Link>
  );
}

/**
 * A user count rendered as a clickable chip that opens the drawer.
 * Drop-in replacement for a bare {fmtNumber(users)} cell.
 */
export function DrillCount({
  value,
  onClick,
  className,
  suffix,
}: {
  value: number;
  onClick: () => void;
  className?: string;
  /** e.g. " users" for prose contexts; omit inside table cells */
  suffix?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title="See who"
      className={cn(
        'inline-flex items-center gap-1 rounded px-1 -mx-1 tabular-nums underline decoration-dotted underline-offset-2',
        'transition-colors hover:bg-accent/10 hover:text-accent',
        className,
      )}
    >
      <Users size={11} aria-hidden="true" className="opacity-60" />
      {fmtNumber(value)}
      {suffix}
    </button>
  );
}
