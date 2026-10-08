import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SUPABASE_URL } from "./helpers";

// Roadmap P4 H (0064): offer_daily_prices, seller_offer_ids, seller_price_profiles. Own fixture rows only.
const tag = randomUUID().slice(0, 8);
let productId = "";
let variantId = "";
let sellerId = "";
let listingId = "";
const offerIds: string[] = [];

beforeAll(async () => {
  const { data: p, error } = await admin
    .from("products")
    .insert({ canonical_name: `P4 seller fixture ${tag}`, slug: `p4-seller-${tag}`, status: "draft" })
    .select("id")
    .single();
  if (error) throw error;
  productId = p.id;
  const { data: v } = await admin.from("product_variants").insert({ product_id: productId, variant_key: "Mặc định" }).select("id").single();
  variantId = v!.id;
  const { data: s } = await admin.from("sellers").insert({ marketplace: "shopee", external_seller_id: `p4-sp-${tag}`, name: "Shop" }).select("id").single();
  sellerId = s!.id;
  const { data: l } = await admin
    .from("listings")
    .insert({ marketplace: "shopee", external_item_id: `p4-sp-${tag}`, seller_id: sellerId, status: "active", last_observed_at: new Date().toISOString() })
    .select("id")
    .single();
  listingId = l!.id;
  for (let i = 0; i < 2; i++) {
    const { data: o, error: oErr } = await admin
      .from("offers")
      .insert({ listing_id: listingId, variant_id: variantId, match_status: "pending", external_model_id: `m${i}` })
      .select("id")
      .single();
    if (oErr) throw oErr;
    offerIds.push(o.id);
  }
  const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const { error: obsErr } = await admin.from("price_observations").insert([
    { offer_id: offerIds[0], price: 100, observed_at: at(30), source: "api", is_flash_sale: false, is_valid: true, original_price: 200 },
    { offer_id: offerIds[0], price: 90, observed_at: at(29), source: "api", is_flash_sale: false, is_valid: true, original_price: 150 },
    { offer_id: offerIds[0], price: 10, observed_at: at(28), source: "api", is_flash_sale: true, is_valid: true, original_price: null },
    { offer_id: offerIds[0], price: 5, observed_at: at(27), source: "api", is_flash_sale: false, is_valid: false, original_price: null, invalid_reason: "test" },
    { offer_id: offerIds[1], price: 300, observed_at: at(5), source: "api", is_flash_sale: false, is_valid: true, original_price: null as number | null },
  ]);
  if (obsErr) throw obsErr;
});
afterAll(async () => {
  await admin.from("listings").delete().eq("id", listingId);
  await admin.from("sellers").delete().eq("id", sellerId);
  await admin.from("products").delete().eq("id", productId);
});

describe("offer_daily_prices", () => {
  it("valid non-flash lows per offer per VN day with that day's highest list price; ≤ 50 offers", async () => {
    const { data, error } = await admin.rpc("offer_daily_prices", {
      p_offer_ids: [offerIds[0], ...Array.from({ length: 60 }, () => randomUUID())],
      p_from: "2000-01-01",
    });
    expect(error).toBeNull();
    const rows = data ?? [];
    expect(rows.every((r) => r.offer_id === offerIds[0])).toBe(true);
    const all = rows.map((r) => Number(r.min_price));
    expect(Math.min(...all)).toBe(90);
    expect(rows.reduce((n, r) => n + r.obs_count, 0)).toBe(2);
    // the 51st+ ids are dropped: offerIds[1] at position 51 is not read
    const { data: capped } = await admin.rpc("offer_daily_prices", {
      p_offer_ids: [...Array.from({ length: 50 }, () => randomUUID()), offerIds[1]],
      p_from: "2000-01-01",
    });
    expect(capped).toEqual([]);
  });
});

describe("seller_offer_ids", () => {
  it("returns the seller with its offers aligned to their variants (draft + pending counts as history)", async () => {
    const before = sellerId.slice(0, 8) === "00000000" ? null : "00000000-0000-0000-0000-000000000000";
    let found: { seller_id: string; offer_ids: string[]; variant_ids: string[] } | undefined;
    let after: string | null = before;
    for (let i = 0; i < 200 && !found; i++) {
      const { data, error } = await admin.rpc("seller_offer_ids", { p_after: after as never, p_limit: 50 });
      expect(error).toBeNull();
      if (!data || data.length === 0) break;
      expect(data.length).toBeLessThanOrEqual(50);
      found = data.find((r) => r.seller_id === sellerId) as typeof found;
      after = data[data.length - 1].seller_id;
    }
    expect(found).toBeDefined();
    expect([...found!.offer_ids].sort()).toEqual([...offerIds].sort());
    expect(found!.variant_ids).toEqual([variantId, variantId]);
  });
});

describe("seller_price_profiles", () => {
  it("anon reads profiles but cannot write them", async () => {
    await admin.from("seller_price_profiles").upsert({
      seller_id: sellerId, computed_at: new Date().toISOString(), window_days: 90, offers_tracked: 1, claim_weeks: 0,
      claim_offers: 0, doubtful_weeks: 0, hike_weeks: 0, median_swing: null, stable_offers: 0, version: "h1",
    });
    const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.from("seller_price_profiles").select("offers_tracked").eq("seller_id", sellerId)).data).toEqual([{ offers_tracked: 1 }]);
    const w = await anon.from("seller_price_profiles").update({ offers_tracked: 99 }).eq("seller_id", sellerId);
    expect(w.error?.code).toBe("42501");
  });
});
