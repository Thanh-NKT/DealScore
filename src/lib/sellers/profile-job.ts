import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { toVnDate } from "@/lib/format";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { computeSellerProfile, type OfferDay } from "@/lib/sellers/profile";
import {
  SELLER_PROFILE_REFRESH_DAYS,
  SELLER_PROFILE_VERSION,
  SELLER_PROFILE_WINDOW_DAYS,
  SELLER_ROLLUP_DAYS,
} from "@/lib/sellers/constants";

type Client = SupabaseClient<Database>;
const DAY = 86_400_000;
/** 10 offers × 90 days ≤ 900 rows per read (PostgREST caps at 1,000). */
const OFFER_CHUNK = 10;
/** 6 variants × 164 days ≤ 984 rows per read. */
const VARIANT_CHUNK = 6;

const n = (v: unknown) => (v == null ? null : Number(v));

/**
 * Weekly seller profiles (spec §6.2), run hourly by /api/cron/insights: pages seller_offer_ids and recomputes
 * only sellers whose profile is missing or older than SELLER_PROFILE_REFRESH_DAYS, so an interrupted run
 * resumes on the next call. Writes seller_price_profiles only.
 */
export async function recomputeSellerProfiles(
  opts: { now: Date; deadline?: number; batch?: number },
  client: Client = createAdminClient(),
): Promise<{ sellers: number; written: number; errors: number; done: boolean }> {
  const stats = { sellers: 0, written: 0, errors: 0, done: false };
  const batch = Math.min(Math.max(opts.batch ?? 50, 1), 50);
  const staleBefore = opts.now.getTime() - SELLER_PROFILE_REFRESH_DAYS * DAY;
  const from = toVnDate(new Date(opts.now.getTime() - SELLER_PROFILE_WINDOW_DAYS * DAY));
  const rollupFrom = toVnDate(new Date(opts.now.getTime() - SELLER_ROLLUP_DAYS * DAY));
  let cursor: string | null = null;

  for (;;) {
    if (opts.deadline && Date.now() > opts.deadline) return stats;
    const after: string | null = cursor;
    type OfferPage = Array<{ seller_id: string; offer_ids: string[] | null; variant_ids: string[] | null }>;
    const res: { data: OfferPage | null; error: { message: string } | null } = await client.rpc("seller_offer_ids", { p_after: after as never, p_limit: batch });
    const page = res.data;
    const error = res.error;
    if (error) throw new Error(`seller_offer_ids failed: ${error.message}`);
    if (!page || page.length === 0) {
      stats.done = true;
      return stats;
    }
    cursor = page[page.length - 1].seller_id;

    const { data: existing, error: pErr } = await client
      .from("seller_price_profiles")
      .select("seller_id, computed_at")
      .in("seller_id", page.map((p) => p.seller_id));
    if (pErr) throw new Error(`Failed to read seller profiles: ${pErr.message}`);
    const fresh = new Set((existing ?? []).filter((e) => Date.parse(e.computed_at) >= staleBefore).map((e) => e.seller_id));

    for (const s of page) {
      if (fresh.has(s.seller_id)) continue;
      if (opts.deadline && Date.now() > opts.deadline) return stats;
      stats.sellers++;
      try {
        const offerIds = s.offer_ids ?? [];
        const variantOf = new Map(offerIds.map((id, i) => [id, (s.variant_ids ?? [])[i]]));
        const days = new Map<string, OfferDay[]>();
        for (let i = 0; i < offerIds.length; i += OFFER_CHUNK) {
          const { data: rows, error: oErr } = await client.rpc("offer_daily_prices", {
            p_offer_ids: offerIds.slice(i, i + OFFER_CHUNK),
            p_from: from,
          });
          if (oErr) throw new Error(`offer_daily_prices failed: ${oErr.message}`);
          for (const r of rows ?? []) {
            const list = days.get(r.offer_id) ?? [];
            list.push({ day: r.day, minPrice: Number(r.min_price), listPrice: n(r.list_price) });
            days.set(r.offer_id, list);
          }
        }
        const variantIds = [...new Set([...variantOf.values()].filter(Boolean))] as string[];
        const variantRows = new Map<string, DailyPriceRow[]>();
        for (let i = 0; i < variantIds.length; i += VARIANT_CHUNK) {
          const { data: rows, error: vErr } = await client
            .from("variant_daily_prices")
            .select("variant_id, day, min_price, median_price, max_price, obs_count, offer_count, has_flash_sale, flash_min_price")
            .in("variant_id", variantIds.slice(i, i + VARIANT_CHUNK))
            .gte("day", rollupFrom)
            .order("day")
            .limit(1000);
          if (vErr) throw new Error(`Failed to read variant rollups: ${vErr.message}`);
          for (const r of rows ?? []) {
            const list = variantRows.get(r.variant_id) ?? [];
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
            variantRows.set(r.variant_id, list);
          }
        }
        const p = computeSellerProfile({
          offers: offerIds.filter((id) => variantOf.get(id)).map((id) => ({ offerId: id, variantId: variantOf.get(id)!, days: days.get(id) ?? [] })),
          variantRows,
          now: opts.now,
        });
        const { error: uErr } = await client.from("seller_price_profiles").upsert({
          seller_id: s.seller_id,
          computed_at: opts.now.toISOString(),
          window_days: SELLER_PROFILE_WINDOW_DAYS,
          offers_tracked: p.offersTracked,
          claim_weeks: p.claimWeeks,
          claim_offers: p.claimOffers,
          doubtful_weeks: p.doubtfulWeeks,
          hike_weeks: p.hikeWeeks,
          median_swing: p.medianSwing,
          stable_offers: p.stableOffers,
          version: SELLER_PROFILE_VERSION,
        });
        if (uErr) throw new Error(uErr.message);
        stats.written++;
      } catch (err) {
        stats.errors++;
        console.error(`recomputeSellerProfiles: seller ${s.seller_id}:`, err instanceof Error ? err.message : err);
      }
    }
    if (page.length < batch) {
      stats.done = true;
      return stats;
    }
  }
}
