/**
 * Cache of generated coaching notes — one row per person × range. input_json
 * is the exact snapshot the model saw (audit + regenerate-on-change), and
 * output_json the validated, sanitised payload.
 */
import type { Db } from '../db/connection';

export interface AiRecommendationRow {
  user_id: number;
  range_key: string;
  generated_at: string;
  model: string;
  input_hash: string;
  input_json: string;
  output_json: string;
  usage_json: string | null;
}

export class AiRecommendationsRepo {
  constructor(private readonly db: Db) {}

  get(userId: number, rangeKey: string): AiRecommendationRow | undefined {
    return this.db
      .prepare(`SELECT * FROM ai_recommendations WHERE user_id = ? AND range_key = ?`)
      .get(userId, rangeKey) as AiRecommendationRow | undefined;
  }

  upsert(row: AiRecommendationRow): void {
    this.db
      .prepare(
        `INSERT INTO ai_recommendations (user_id, range_key, generated_at, model, input_hash, input_json, output_json, usage_json)
         VALUES (@user_id, @range_key, @generated_at, @model, @input_hash, @input_json, @output_json, @usage_json)
         ON CONFLICT (user_id, range_key) DO UPDATE SET
           generated_at = excluded.generated_at,
           model        = excluded.model,
           input_hash   = excluded.input_hash,
           input_json   = excluded.input_json,
           output_json  = excluded.output_json,
           usage_json   = excluded.usage_json`,
      )
      .run(row);
  }

  deleteForUser(userId: number): number {
    return this.db.prepare(`DELETE FROM ai_recommendations WHERE user_id = ?`).run(userId).changes;
  }

  /** Everything — after a prompt change, every cached note was written under the old prompt. */
  clearAll(): number {
    return this.db.prepare(`DELETE FROM ai_recommendations`).run().changes;
  }

  /** Rows older than `days` — nobody looks at last month's coaching notes. */
  pruneOlderThan(days: number): number {
    const before = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.db.prepare(`DELETE FROM ai_recommendations WHERE generated_at < ?`).run(before).changes;
  }

  // --- generation ledger (never pruned; a few hundred bytes per model call) ---

  logGeneration(row: AiGenerationLogRow): void {
    this.db
      .prepare(
        `INSERT INTO ai_generation_log (user_id, generated_at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, structured, attempts, duration_ms)
         VALUES (@user_id, @generated_at, @model, @input_tokens, @output_tokens, @cache_read_tokens, @cache_write_tokens, @structured, @attempts, @duration_ms)`,
      )
      .run(row);
  }

  /** Token totals for generations at or after `sinceIso` (null = all time). */
  usageSince(sinceIso: string | null): UsageTotalsRow {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS generations,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens), 0) AS cache_write_tokens,
                MAX(generated_at) AS last_generated_at
         FROM ai_generation_log
         WHERE (? IS NULL OR generated_at >= ?)`,
      )
      .get(sinceIso, sinceIso) as UsageTotalsRow;
  }
}

export interface AiGenerationLogRow {
  user_id: number;
  generated_at: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  structured: 0 | 1;
  attempts: number;
  duration_ms: number;
}

export interface UsageTotalsRow {
  generations: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  last_generated_at: string | null;
}
