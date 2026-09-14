import type { SkillCatalogEntry, SkillCatalogUploadEntry, SkillSource } from '@dash/shared';
import type { Db } from '../db/connection';

interface CatalogRow {
  name: string;
  source: string;
  plugin_name: string;
  description: string;
  version: string | null;
  allowed_tools: string;
  model: string | null;
  path: string | null;
  reported_by: string | null;
  updated_at: string;
}

/** allowed_tools is stored as JSON; a malformed row degrades to [] rather than throwing. */
function parseTools(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function toEntry(row: CatalogRow): SkillCatalogEntry {
  return {
    name: row.name,
    source: row.source as SkillSource,
    pluginName: row.plugin_name,
    description: row.description,
    version: row.version,
    allowedTools: parseTools(row.allowed_tools),
    model: row.model,
    path: row.path,
    reportedBy: row.reported_by,
    updatedAt: row.updated_at,
  };
}

/**
 * The skill catalog: what each skill IS, pushed by `pnpm skills:scan` from a
 * machine that has the skills installed. Never touched by the OTel receiver —
 * usage counts and catalog metadata are joined by name in the UI.
 */
export class SkillCatalogRepo {
  constructor(private readonly db: Db) {}

  list(): SkillCatalogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT name, source, plugin_name, description, version, allowed_tools, model, path,
                reported_by, updated_at
           FROM skill_catalog
          ORDER BY name COLLATE NOCASE, source, plugin_name`,
      )
      .all() as CatalogRow[];
    return rows.map(toEntry);
  }

  lastUpdatedAt(): string | null {
    const row = this.db.prepare(`SELECT MAX(updated_at) AS ts FROM skill_catalog`).get() as
      | { ts: string | null }
      | undefined;
    return row?.ts ?? null;
  }

  /**
   * Upsert a scanned batch. `replaceReporter` deletes this reporter's entries
   * that the batch no longer contains — how an uninstalled skill disappears.
   * One transaction so a partial batch never leaves a half-swapped catalog.
   */
  upsertBatch(
    entries: SkillCatalogUploadEntry[],
    reportedBy: string | null,
    replaceReporter: boolean,
  ): { upserted: number; deleted: number } {
    const upsert = this.db.prepare(
      `INSERT INTO skill_catalog
         (name, source, plugin_name, description, version, allowed_tools, model, path, reported_by, updated_at)
       VALUES
         (@name, @source, @pluginName, @description, @version, @allowedTools, @model, @path, @reportedBy, @updatedAt)
       ON CONFLICT (name, source, plugin_name) DO UPDATE SET
         description   = excluded.description,
         version       = excluded.version,
         allowed_tools = excluded.allowed_tools,
         model         = excluded.model,
         path          = excluded.path,
         reported_by   = excluded.reported_by,
         updated_at    = excluded.updated_at`,
    );
    const delStale = this.db.prepare(
      `DELETE FROM skill_catalog WHERE reported_by = ? AND updated_at < ?`,
    );

    const txn = this.db.transaction((): { upserted: number; deleted: number } => {
      // one stamp for the whole batch is what makes the "< stamp" sweep exact;
      // ISO-8601 with Z so the UI's relative formatter can parse it back
      const updatedAt = new Date().toISOString();
      for (const e of entries) {
        upsert.run({
          name: e.name,
          source: e.source,
          pluginName: e.pluginName ?? '',
          description: e.description ?? '',
          version: e.version ?? null,
          allowedTools: JSON.stringify(e.allowedTools ?? []),
          model: e.model ?? null,
          path: e.path ?? null,
          reportedBy,
          updatedAt,
        });
      }
      const deleted =
        replaceReporter && reportedBy !== null ? delStale.run(reportedBy, updatedAt).changes : 0;
      return { upserted: entries.length, deleted };
    });
    return txn();
  }
}
