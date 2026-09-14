/**
 * Skill catalog lookup + source badge, for the places on the Skills page that
 * pair a name with its SKILL.md frontmatter (the filter, the bar tooltip, the
 * top-skill chip, the coverage footer).
 *
 * Entries come from GET /api/skills/catalog, pushed by `pnpm skills:scan`.
 * Where a skill CAME FROM is telemetry's job — otel_skill_meta fills that in
 * automatically and the entity drawer renders it; this file never competes
 * with it, and carries only what no event contains.
 */
import { useMemo, type ReactNode } from 'react';
import { Package, FileCode2, FolderGit2, Sparkles } from 'lucide-react';
import type { SkillCatalogEntry, SkillSource } from '@dash/shared';
import { cn } from '@/lib/utils';

/**
 * Name → entry, indexed twice: by the invocation name the scanner records
 * (`atlassian:jira`) and by the bare frontmatter name (`jira`), because which
 * of the two an OTel event carries depends on how the skill was started.
 * The qualified name always wins a collision.
 */
export type SkillCatalogIndex = ReadonlyMap<string, SkillCatalogEntry>;

export function buildSkillCatalogIndex(entries: readonly SkillCatalogEntry[]): SkillCatalogIndex {
  const index = new Map<string, SkillCatalogEntry>();
  for (const e of entries) {
    const bare = e.name.includes(':') ? e.name.slice(e.name.indexOf(':') + 1) : e.name;
    if (bare !== e.name && !index.has(bare)) index.set(bare, e);
  }
  // second pass: qualified names overwrite any bare-name collision above
  for (const e of entries) index.set(e.name, e);
  return index;
}

export function useSkillCatalogIndex(entries: readonly SkillCatalogEntry[] | undefined): SkillCatalogIndex {
  return useMemo(() => buildSkillCatalogIndex(entries ?? []), [entries]);
}

const SOURCE_META: Record<SkillSource, { label: string; icon: typeof Package; cls: string }> = {
  personal: { label: 'Personal', icon: FileCode2, cls: 'border-accent/40 text-accent' },
  project: { label: 'Project', icon: FolderGit2, cls: 'border-accent2/40 text-accent2' },
  plugin: { label: 'Plugin', icon: Package, cls: 'border-border text-muted' },
  builtin: { label: 'Built-in', icon: Sparkles, cls: 'border-border text-muted' },
};

export function SkillSourceBadge({
  source,
  pluginName,
  className,
  children,
}: {
  source: SkillSource;
  pluginName?: string;
  className?: string;
  /** trailing content, e.g. a count in a tally */
  children?: ReactNode;
}) {
  const meta = SOURCE_META[source];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10.5px] leading-none',
        meta.cls,
        className,
      )}
    >
      <Icon size={10} aria-hidden="true" />
      {source === 'plugin' && pluginName ? pluginName : meta.label}
      {children !== undefined && <span className="tabular-nums opacity-80">{children}</span>}
    </span>
  );
}
