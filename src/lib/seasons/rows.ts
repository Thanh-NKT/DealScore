import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { addDays, vnDay } from "@/lib/seasons/events";
import { SEASON_HISTORY_DAYS } from "@/lib/seasons/constants";

type Client = SupabaseClient<Database>;
const n = (v: unknown) => (v == null ? null : Number(v));

/** 400 rollup days of one variant (≤ 400 rows, under the 1,000-row cap). */
export async function loadSeasonRows(client: Client, variantId: string, now: Date): Promise<DailyPriceRow[]> {
  const from = addDays(vnDay(now), -SEASON_HISTORY_DAYS);
  const { data, error } = await client
    .from("variant_daily_prices")
    .select("day, min_price, median_price, max_price, obs_count, offer_count, has_flash_sale, flash_min_price")
    .eq("variant_id", variantId)
    .gte("day", from)
    .order("day")
    .limit(SEASON_HISTORY_DAYS + 5);
  if (error) throw new Error(`Failed to read season rollups: ${error.message}`);
  return (data ?? []).map((r) => ({
    day: r.day,
    min_price: n(r.min_price),
    median_price: n(r.median_price),
    max_price: n(r.max_price),
    obs_count: r.obs_count,
    offer_count: r.offer_count,
    has_flash_sale: r.has_flash_sale,
    flash_min_price: n(r.flash_min_price),
  }));
}

