import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { computeDealScore, type Recommendation } from "@/lib/pricing/deal-score";
import { expandRollup, type DailyPriceRow } from "@/lib/pricing/price-history";
import { toVnDate } from "@/lib/format";

/**
 * Write the Deal Score cache used to sort search listings (decision Đ5).
 *
 * The detail page still computes live and is the source of truth; this cache only exists because
 * you can't sort by score before paginating if the score only lives in Node. MUST use
 * computeDealScore() — never re-implement scoring in SQL. No bestOffer is passed, exactly like the
 * header score (Đ7), so listing and detail page show the same number.
 *
 * Every read is chunked: PostgREST silently truncates at 1000 rows.
 */

const WINDOW_DAYS = 90;
const PAGE = 1000;
/** 10 variants × 90 days ≤ 900 rollup rows per query — under the 1000-row cap. */
const HISTORY_CHUNK = 10;
const UPSERT_BATCH = 500;

export async function recomputeDealScores(
  client: SupabaseClient<Database>,
  opts: { now?: Date; variantIds?: string[] } = {},
): Promise<{ scored: number; tally: Partial<Record<Recommendation, number>> }> {
  const now = opts.now ?? new Date();
  const since = toVnDate(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));

  const current: Array<{ variant_id: string; price: number | null }> = [];
  if (opts.variantIds) {
    for (let i = 0; i < opts.variantIds.length; i += PAGE) {
      const { data, error } = await client
        .from("variant_current_price")
        .select("variant_id, price")
        .in("variant_id", opts.variantIds.slice(i, i + PAGE));
      if (error) throw new Error(`Failed to read current prices: ${error.message}`);
      current.push(...(data ?? []));
    }
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("variant_current_price")
        .select("variant_id, price")
        .order("variant_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to read current prices: ${error.message}`);
      current.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }

  const priced = current.filter((c): c is { variant_id: string; price: number } => c.price != null);
  const rows: Database["public"]["Tables"]["variant_deal_scores"]["Insert"][] = [];
  const tally: Partial<Record<Recommendation, number>> = {};

  for (let i = 0; i < priced.length; i += HISTORY_CHUNK) {
    const chunk = priced.slice(i, i + HISTORY_CHUNK);
    const { data: history, error } = await client
      .from("variant_daily_prices")
      .select("*")
      .in("variant_id", chunk.map((c) => c.variant_id))
      .gte("day", since)
      .order("day", { ascending: true });
    if (error) throw new Error(`Failed to read daily prices: ${error.message}`);

    const byVariant = new Map<string, DailyPriceRow[]>();
    for (const h of history ?? []) {
      const list = byVariant.get(h.variant_id) ?? [];
      list.push(h as unknown as DailyPriceRow);
      byVariant.set(h.variant_id, list);
    }

    for (const v of chunk) {
      const result = computeDealScore({
        price: Number(v.price),
        history: expandRollup(byVariant.get(v.variant_id) ?? []),
        now,
      });
      tally[result.recommendation] = (tally[result.recommendation] ?? 0) + 1;
      rows.push({
        variant_id: v.variant_id,
        score: result.score,
        recommendation: result.recommendation,
        price_at_compute: Number(v.price),
        computed_at: now.toISOString(),
      });
    }
  }

  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const { error } = await client
      .from("variant_deal_scores")
      .upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: "variant_id" });
    if (error) throw new Error(`Failed to write deal scores: ${error.message}`);
  }

  return { scored: rows.length, tally };
}
