import { randomUUID } from "node:crypto";
import { toVnDate } from "@/lib/format";
import { admin } from "./helpers";

export interface SeededVariant {
  productId: string;
  variantId: string;
  listingId: string;
  offerId: string;
  cleanup: () => Promise<void>;
}

/**
 * A verified product with one variant / listing / offer, a fresh current price and a daily rollup:
 * `daily(daysAgo)` gives min_price for day today−daysAgo (VN calendar), null = no row. Days 1..`days`.
 */
export async function seedVariantWithHistory(opts: {
  price: number | null;
  inStock?: boolean;
  days: number;
  daily: (daysAgo: number) => number | null;
  originalPrice?: number | null;
}): Promise<SeededVariant> {
  const tag = `sh${randomUUID().replace(/-/g, "").slice(0, 10)}`;
  const { data: c } = await admin.from("categories").select("id").limit(1).single();
  const { data: p, error } = await admin
    .from("products")
    .insert({ canonical_name: `Seed ${tag}`, brand: "Test", status: "verified", slug: `test-${tag}`, category_id: c!.id })
    .select("id")
    .single();
  if (error) throw error;
  const { data: v } = await admin.from("product_variants").insert({ product_id: p.id, variant_key: "Mặc định" }).select("id").single();
  const { data: l } = await admin
    .from("listings")
    .insert({ marketplace: "shopee", external_item_id: `ext-${tag}`, url: `https://shopee.vn/${tag}`, title: tag, status: "active" })
    .select("id")
    .single();
  const { data: o } = await admin.from("offers").insert({ listing_id: l!.id, variant_id: v!.id, match_status: "manual" }).select("id").single();
  const { error: vcpErr } = await admin.from("variant_current_price").upsert({
    variant_id: v!.id,
    price: opts.price,
    original_price: opts.originalPrice ?? null,
    in_stock: opts.inStock ?? true,
    is_flash_sale: false,
    observed_at: new Date().toISOString(),
    best_offer_id: o!.id,
    offer_count: 1,
  });
  if (vcpErr) throw vcpErr;
  const now = Date.now();
  const rows = [];
  for (let d = 1; d <= opts.days; d++) {
    const price = opts.daily(d);
    if (price == null) continue;
    rows.push({
      variant_id: v!.id,
      day: toVnDate(new Date(now - d * 86_400_000)),
      min_price: price,
      median_price: price,
      max_price: price,
      obs_count: 1,
      offer_count: 1,
    });
  }
  if (rows.length) {
    const { error: dErr } = await admin.from("variant_daily_prices").upsert(rows);
    if (dErr) throw dErr;
  }
  return {
    productId: p.id,
    variantId: v!.id,
    listingId: l!.id,
    offerId: o!.id,
    cleanup: async () => {
      await admin.from("listings").delete().eq("id", l!.id);
      await admin.from("products").delete().eq("id", p.id);
    },
  };
}
