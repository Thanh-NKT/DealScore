import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { scoreDeal } from "@/lib/pricing/score";
import { expandRollup, type DailyPriceRow } from "@/lib/pricing/price-history";
import { toVnDate } from "@/lib/format";
import { STALE_HOURS } from "@/lib/watch/constants";
import type { VariantSnapshot } from "@/lib/watch/types";

/** PostgREST silently truncates at 1,000 rows. 10 variants × 91 days ≤ 910 rows. */
const ROLLUP_CHUNK = 10;
const PG_MAX_ROWS = 1000;
const n = (v: unknown) => (v == null ? null : Number(v));

function chunks<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export async function loadVariantSnapshots(
  client: SupabaseClient<Database>,
  variantIds: string[],
  now: Date,
): Promise<Map<string, VariantSnapshot>> {
  const ids = [...new Set(variantIds)];
  const result = new Map<string, VariantSnapshot>();
  if (ids.length === 0) return result;

  const current = new Map<string, Database["public"]["Tables"]["variant_current_price"]["Row"]>();
  for (const part of chunks(ids, 500)) {
    const { data, error } = await client.from("variant_current_price").select("*").in("variant_id", part);
    if (error) throw new Error(`Failed to read variant_current_price: ${error.message}`);
    for (const r of data ?? []) current.set(r.variant_id, r);
  }

  const since = toVnDate(new Date(now.getTime() - 90 * 86_400_000));
  const history = new Map<string, DailyPriceRow[]>();
  for (const part of chunks(ids, ROLLUP_CHUNK)) {
    const { data, error } = await client
      .from("variant_daily_prices")
      .select("*")
      .in("variant_id", part)
      .gte("day", since)
      .order("day", { ascending: true });
    if (error) throw new Error(`Failed to read variant_daily_prices: ${error.message}`);
    if ((data ?? []).length >= PG_MAX_ROWS) throw new Error("Rollup hit the 1,000-row limit — reduce ROLLUP_CHUNK");
    for (const r of data ?? []) {
      const list = history.get(r.variant_id) ?? [];
      list.push({
        day: r.day,
        min_price: n(r.min_price),
        median_price: n(r.median_price),
        max_price: n(r.max_price),
        obs_count: r.obs_count,
        offer_count: r.offer_count,
        has_flash_sale: r.has_flash_sale,
        flash_min_price: n(r.flash_min_price),
      });
      history.set(r.variant_id, list);
    }
  }

  for (const id of ids) {
    const c = current.get(id);
    if (!c) {
      result.set(id, { variantId: id, price: null, inStock: false, offerId: null, observedAt: null, isStale: true, deal: null });
      continue;
    }
    const price = n(c.price);
    const isStale = !c.observed_at || now.getTime() - new Date(c.observed_at).getTime() > STALE_HOURS * 3_600_000;
    result.set(id, {
      variantId: id,
      price,
      inStock: c.in_stock,
      offerId: c.best_offer_id,
      observedAt: c.observed_at,
      isStale,
      // NO bestOffer (Đ7): the numbers in an alert must match the product page header score.
      deal: price != null && price > 0 ? scoreDeal({ price, history: expandRollup(history.get(id) ?? []), now, isFlashSale: c.is_flash_sale }) : null,
    });
  }
  return result;
}
