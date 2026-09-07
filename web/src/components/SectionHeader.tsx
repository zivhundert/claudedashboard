/** Small uppercase divider that names a group of cards on a page. */
export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="col-span-12 mt-1 flex flex-wrap items-baseline gap-x-2 first:mt-0">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</span>
      {hint && <span className="text-[11px] text-muted/80">{hint}</span>}
    </div>
  );
}
