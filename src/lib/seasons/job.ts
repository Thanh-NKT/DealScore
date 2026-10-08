import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, seasonWindows, vnDay } from "@/lib/seasons/events";
import { seasonOccurrences } from "@/lib/seasons/calendar";
import { aggregateCategorySeason } from "@/lib/seasons/category";
import { SEASON_HISTORY_DAYS, SEASON_JOB_MAX_VARIANTS, SEASON_STATS_REFRESH_DAYS } from "@/lib/seasons/constants";
import { loadSeasonRows } from "@/lib/seasons/rows";

type Client = SupabaseClient<Database>;

/**
 * Weekly category season cache (spec §8.2), run hourly by /api/cron/insights: categories whose stats are
 * missing or older than SEASON_STATS_REFRESH_DAYS; per category its ≤ 200 most-observed verified variants.
 * A category interrupted by the deadline is not written (it stays stale and is redone next run).
 */
export async function recomputeCategorySeasons(
  /** `categoryIds`: only those categories (tests: never recompute another file's or the owner's caches). */
  opts: { now: Date; deadline?: number; categoryIds?: string[] },
  client: Client = createAdminClient(),
): Promise<{ categories: number; written: number; errors: number; done: boolean }> {
  const stats = { categories: 0, written: 0, errors: 0, done: false };
  let catQuery = client.from("categories").select("id").order("id").limit(1000);
  let statQuery = client.from("category_season_stats").select("category_id, computed_at").limit(10_000);
  if (opts.categoryIds) {
    catQuery = catQuery.in("id", opts.categoryIds);
    statQuery = statQuery.in("category_id", opts.categoryIds);
  }
  const [catRes, statRes] = await Promise.all([catQuery, statQuery]);
  if (catRes.error) throw new Error(`Failed to read categories: ${catRes.error.message}`);
  if (statRes.error) throw new Error(`Failed to read season stats: ${statRes.error.message}`);
  const staleBefore = opts.now.getTime() - SEASON_STATS_REFRESH_DAYS * 86_400_000;
  const fresh = new Set((statRes.data ?? []).filter((s) => Date.parse(s.computed_at) >= staleBefore).map((s) => s.category_id));
  const today = vnDay(opts.now);
  const windows = seasonWindows(addDays(today, -SEASON_HISTORY_DAYS), today).filter((w) => w.end < today);

  categories: for (const c of catRes.data ?? []) {
    if (fresh.has(c.id)) continue;
    if (opts.deadline && Date.now() > opts.deadline) return stats;
    stats.categories++;
    try {
      const { data: vids, error } = await client.rpc("season_variant_ids", { p_category_id: c.id, p_limit: SEASON_JOB_MAX_VARIANTS });
      if (error) throw new Error(`season_variant_ids failed: ${error.message}`);
      const perVariant = [];
      for (const v of vids ?? []) {
        if (opts.deadline && Date.now() > opts.deadline) continue categories;
        perVariant.push(seasonOccurrences(await loadSeasonRows(client, v.variant_id, opts.now), windows));
      }
      const rows = aggregateCategorySeason(perVariant);
      const computedAt = opts.now.toISOString();
      if (rows.length > 0) {
        const { error: uErr } = await client.from("category_season_stats").upsert(
          rows.map((r) => ({
            category_id: c.id,
            event_key: r.key,
            variants_counted: r.variantsCounted,
            occurrences: r.occurrences,
            median_ratio: r.medianRatio,
            share_lower: r.shareLower,
            computed_at: computedAt,
          })),
        );
        if (uErr) throw new Error(uErr.message);
      }
      // Keys no longer present go away (one category = one consistent snapshot).
      let del = client.from("category_season_stats").delete().eq("category_id", c.id);
      if (rows.length > 0) del = del.not("event_key", "in", `(${rows.map((r) => `"${r.key}"`).join(",")})`);
      const { error: dErr } = await del;
      if (dErr) throw new Error(dErr.message);
      stats.written++;
    } catch (err) {
      stats.errors++;
      console.error(`recomputeCategorySeasons: category ${c.id}:`, err instanceof Error ? err.message : err);
    }
  }
  stats.done = true;
  return stats;
}
