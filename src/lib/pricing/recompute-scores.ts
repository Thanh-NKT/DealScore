import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { scoreDeal } from "@/lib/pricing/score";
import { expandRollup, type DailyPriceRow } from "@/lib/pricing/price-history";
import { toVnDate } from "@/lib/format";
import { fakeSaleForPrice } from "@/lib/pricing/variant-pricing";

/**
 * Write the Deal Score cache used to sort search listings (decision Đ5).
 *
 * The detail page still computes live and is the source of truth; this cache only exists because
 * you can't sort by score before paginating if the score only lives in Node. MUST use
 * computeDealScore() — never re-implement scoring in SQL. No bestOffer is passed, exactly like the
 * header score (Đ7), so listing and detail page show the same number. Goes through scoreDeal() so
 * the cache always uses the same Deal Score version as the page.
 *
 * A variant whose current price is out of stock everywhere gets NO cached verdict (its row is deleted),
 * like the detail page, which shows no headline when every offer is out of stock.
 *
 * The same pass caches the fake-sale kind of the BEST offer (`fake_sale`), from fakeSaleForPrice() — the
 * check the product page runs per offer — on the price + list price the card's "−X%" is computed from.
 *
 * Every read is chunked: PostgREST silently truncates at 1000 rows.
 */

const WINDOW_DAYS = 90;
const PAGE = 1000;
/** 10 variants × 90 days ≤ 900 rollup rows per query — under the 1000-row cap. */
const HISTORY_CHUNK = 10;
const UPSERT_BATCH = 500;
const DELETE_BATCH = 200;

export async function recomputeDealScores(
  client: SupabaseClient<Database>,
  opts: { now?: Date; variantIds?: string[] } = {},
): Promise<{ scored: number; tally: Partial<Record<Recommendation, number>> }> {
  const now = opts.now ?? new Date();
  const since = toVnDate(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));

  type CurrentRow = {
    variant_id: string;
    price: number | null;
    original_price: number | null;
    in_stock: boolean;
    is_flash_sale: boolean;
  };
  const current: CurrentRow[] = [];
  if (opts.variantIds) {
    for (let i = 0; i < opts.variantIds.length; i += PAGE) {
      const { data, error } = await client
        .from("variant_current_price")
        .select("variant_id, price, original_price, in_stock, is_flash_sale")
        .in("variant_id", opts.variantIds.slice(i, i + PAGE));
      if (error) throw new Error(`Failed to read current prices: ${error.message}`);
      current.push(...(data ?? []));
    }
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from("variant_current_price")
        .select("variant_id, price, original_price, in_stock, is_flash_sale")
        .order("variant_id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`Failed to read current prices: ${error.message}`);
      current.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
  }

  const priced = current.filter(
    (c): c is CurrentRow & { price: number; in_stock: true } => c.price != null && c.in_stock,
  );
  const outOfStock = current.filter((c) => c.price != null && !c.in_stock).map((c) => c.variant_id);
  for (let i = 0; i < outOfStock.length; i += DELETE_BATCH) {
    const { error } = await client
      .from("variant_deal_scores")
      .delete()
      .in("variant_id", outOfStock.slice(i, i + DELETE_BATCH));
    if (error) throw new Error(`Failed to drop out-of-stock deal scores: ${error.message}`);
  }
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
      const daily = byVariant.get(v.variant_id) ?? [];
      const result = scoreDeal({
        price: Number(v.price),
        history: expandRollup(daily),
        now,
        // Same flag as the product page header, so the cached verdict and reasons match it.
        isFlashSale: v.is_flash_sale,
      });
      tally[result.recommendation] = (tally[result.recommendation] ?? 0) + 1;
      rows.push({
        variant_id: v.variant_id,
        score: result.score,
        recommendation: result.recommendation,
        price_at_compute: Number(v.price),
        computed_at: now.toISOString(),
        fake_sale: fakeSaleForPrice({
          price: Number(v.price),
          originalPrice: v.original_price == null ? null : Number(v.original_price),
          rows: daily,
          now,
        }).kind,
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
