import type { EntityKind } from '@dash/shared';
import { useEntityStore } from '@/state/entity';
import { cn } from '@/lib/utils';

/**
 * A skill / subagent / tool / MCP server / plugin name that opens the detail
 * drawer. `label` overrides what is shown (e.g. the short tool name); `name` is
 * the telemetry identifier the drawer looks up.
 */
export function EntityName({
  kind,
  name,
  label,
  className,
  title,
}: {
  kind: EntityKind;
  name: string;
  label?: string;
  className?: string;
  title?: string;
}) {
  const open = useEntityStore((s) => s.open);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open(kind, name);
      }}
      title={title ?? `${name} — details`}
      className={cn(
        'max-w-full truncate text-left underline decoration-dotted underline-offset-2 transition-colors hover:text-accent',
        className,
      )}
    >
      {label ?? name}
    </button>
  );
}
