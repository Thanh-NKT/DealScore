/**
 * Write the Deal Score cache for search listings (decision Đ5).
 *
 * The detail page still computes live from the rollup and is the source of truth; the
 * variant_deal_scores table only exists because you can't sort by score before
 * paginating if the score only lives in Node.
 *
 * MUST use computeDealScore() from src/lib/pricing/deal-score.ts. Never re-implement
 * the scoring logic in SQL — two implementations will drift apart.
 *
 * No bestOffer is passed, exactly like the header score (Đ7) — otherwise the listing
 * and the detail page would show two different numbers for the same product.
 *
 * Run after every collector run: pnpm scores:recompute
 */

import { createClient } from "@supabase/supabase-js";
import { computeDealScore } from "../src/lib/pricing/deal-score";
import { expandRollup, type DailyPriceRow } from "../src/lib/pricing/price-history";
import { toVnDate } from "../src/lib/format";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const WINDOW_DAYS = 90;
const BATCH = 500;

async function main() {
  const { data: current, error: curErr } = await db
    .from("variant_current_price")
    .select("variant_id, price");
  if (curErr) throw curErr;

  // One `now` for the whole run; windows use Vietnam calendar days, same as the detail page.
  const now = new Date();
  const since = toVnDate(new Date(now.getTime() - WINDOW_DAYS * 86_400_000));

  const rows: Record<string, unknown>[] = [];
  const tally: Record<string, number> = {};

  for (const v of current ?? []) {
    if (v.price == null) continue;

    const { data: history, error: hErr } = await db
      .from("variant_daily_prices")
      .select("*")
      .eq("variant_id", v.variant_id)
      .gte("day", since)
      .order("day", { ascending: true });
    if (hErr) throw hErr;

    const result = computeDealScore({
      price: v.price,
      history: expandRollup((history ?? []) as DailyPriceRow[]),
      now,
    });

    tally[result.recommendation] = (tally[result.recommendation] ?? 0) + 1;

    rows.push({
      variant_id: v.variant_id,
      score: result.score,
      recommendation: result.recommendation,
      price_at_compute: v.price,
      computed_at: now.toISOString(),
    });
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db
      .from("variant_deal_scores")
      .upsert(rows.slice(i, i + BATCH), { onConflict: "variant_id" });
    if (error) throw error;
  }

  console.log(`Scored ${rows.length} variants.`);
  for (const [k, n] of Object.entries(tally).sort()) {
    console.log(`  ${k.padEnd(18)} ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
