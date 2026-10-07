import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Migration 0042: search_products v14 — p_only_buy ("Chỉ hiện Nên mua"), offer_count and fake_sale.
const tag = `cf${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const productIds: string[] = [];
const listingIds: string[] = [];
const byName: Record<string, string> = {};

type Seed = { name: string; rec: string; atPrice: number; fake: string | null; offerCount: number };
const PRICE = 1_000_000;
const SEEDS: Seed[] = [
  { name: "buy", rec: "buy", atPrice: PRICE, fake: "list_inflated", offerCount: 3 },
  { name: "wait", rec: "wait", atPrice: PRICE, fake: null, offerCount: 1 },
  { name: "insufficient", rec: "insufficient_data", atPrice: PRICE, fake: null, offerCount: 1 },
  // Cache computed for an older price: neither its verdict nor its fake-sale flag may show.
  { name: "stale", rec: "buy", atPrice: PRICE + 50_000, fake: "pre_sale_hike", offerCount: 2 },
];

beforeAll(async () => {
  const { data: c } = await admin.from("categories").select("id").limit(1).single();
  for (const s of SEEDS) {
    const { data: p, error } = await admin
      .from("products")
      .insert({ canonical_name: `Tai nghe ${tag} ${s.name}`, brand: "Sony", status: "verified", slug: `test-${tag}-${s.name}`, category_id: c!.id })
      .select("id")
      .single();
    if (error) throw error;
    productIds.push(p.id);
    byName[s.name] = p.id;
    const { data: v } = await admin.from("product_variants").insert({ product_id: p.id, variant_key: "Đen" }).select("id").single();
    const { data: l } = await admin
      .from("listings")
      .insert({ marketplace: "shopee", external_item_id: `ext-${tag}-${s.name}`, url: `https://shopee.vn/${tag}-${s.name}`, title: s.name, status: "active" })
      .select("id")
      .single();
    listingIds.push(l!.id);
    const { data: o } = await admin.from("offers").insert({ listing_id: l!.id, variant_id: v!.id, match_status: "manual" }).select("id").single();
    const { error: e1 } = await admin.from("variant_current_price").upsert({
      variant_id: v!.id,
      price: PRICE,
      original_price: 1_500_000,
      in_stock: true,
      is_flash_sale: false,
      observed_at: new Date().toISOString(),
      best_offer_id: o!.id,
      offer_count: s.offerCount,
    });
    if (e1) throw e1;
    const { error: e2 } = await admin.from("variant_deal_scores").upsert({
      variant_id: v!.id,
      score: s.rec === "insufficient_data" ? null : 80,
      recommendation: s.rec,
      price_at_compute: s.atPrice,
      fake_sale: s.fake,
    });
    if (e2) throw e2;
  }
});

afterAll(async () => {
  await admin.from("listings").delete().in("id", listingIds);
  await admin.from("products").delete().in("id", productIds);
});

describe("search_products v14 (0042)", () => {
  it("without p_only_buy every seeded card is returned, with offer_count and the guarded fake_sale", async () => {
    const { data, error } = await admin.rpc("search_products", { p_q: tag });
    expect(error).toBeNull();
    const rows = Object.fromEntries((data ?? []).map((r) => [r.product_id, r]));
    expect(Object.keys(rows).sort()).toEqual([...productIds].sort());
    expect(rows[byName.buy]).toMatchObject({ offer_count: 3, fake_sale: "list_inflated", recommendation: "buy" });
    expect(rows[byName.stale]).toMatchObject({ offer_count: 2, fake_sale: null, recommendation: null });
    expect(Number(data![0].total_count)).toBe(4);
  });

  it("p_only_buy returns only the cached buy verdict for the shown price; total_count counts after the filter", async () => {
    const { data, error } = await admin.rpc("search_products", { p_q: tag, p_only_buy: true });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.product_id)).toEqual([byName.buy]);
    expect(Number(data![0].total_count)).toBe(1);
  });

  it("p_only_buy false behaves like null", async () => {
    const { data } = await admin.rpc("search_products", { p_q: tag, p_only_buy: false });
    expect(data).toHaveLength(4);
  });

  it("variant_deal_scores.fake_sale rejects unknown kinds", async () => {
    const { data: v } = await admin.from("variant_deal_scores").select("variant_id").eq("fake_sale", "list_inflated").limit(1).single();
    const { error } = await admin.from("variant_deal_scores").update({ fake_sale: "bogus" }).eq("variant_id", v!.variant_id);
    expect(error?.code).toBe("23514");
  });
});
