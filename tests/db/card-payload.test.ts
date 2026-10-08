import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

// Migration 0026: product cards get the marketplace of the price they show and its flash-sale flag,
// from search_products, price_drop_radar and trending_products (review-pricing-ui I3, I5).
const tag = `cp${randomUUID().replace(/-/g, "").slice(0, 8)}`;
let productId: string;
let variantId: string;
let listingId: string;

beforeAll(async () => {
  const { data: c } = await admin.from("categories").select("id").order("slug").limit(1).single();
  const { data: p, error } = await admin
    .from("products")
    .insert({ canonical_name: `Loa card ${tag}`, brand: "Sony", status: "verified", slug: `test-${tag}`, category_id: c!.id })
    .select("id")
    .single();
  if (error) throw error;
  productId = p.id;
  const { data: v } = await admin.from("product_variants").insert({ product_id: productId, variant_key: "Đen" }).select("id").single();
  variantId = v!.id;
  const { data: l } = await admin
    .from("listings")
    .insert({ marketplace: "tiktok", external_item_id: `ext-${tag}`, url: `https://shop.tiktok.com/${tag}`, title: `Loa ${tag}`, status: "active" })
    .select("id")
    .single();
  listingId = l!.id;
  const { data: o } = await admin
    .from("offers")
    .insert({ listing_id: listingId, variant_id: variantId, match_status: "manual" })
    .select("id")
    .single();
  const { error: vcpError } = await admin.from("variant_current_price").upsert({
    variant_id: variantId,
    price: 500_000,
    original_price: 900_000,
    in_stock: true,
    is_flash_sale: true,
    observed_at: new Date().toISOString(),
    best_offer_id: o!.id,
    offer_count: 1,
  });
  if (vcpError) throw vcpError;
});

afterAll(async () => {
  await admin.from("listings").delete().eq("id", listingId);
  await admin.from("products").delete().eq("id", productId);
});

describe("card payload (0026)", () => {
  it("search_products returns the best offer's marketplace and the flash-sale flag", async () => {
    const { data, error } = await admin.rpc("search_products", { p_q: `loa card ${tag}` });
    expect(error).toBeNull();
    const row = data!.find((r) => r.product_id === productId)!;
    expect(row).toMatchObject({ marketplace: "tiktok", is_flash_sale: true, best_price: 500_000 });
  });

  it("trending_products carries the same two columns", async () => {
    const { data, error } = await admin.rpc("trending_products", { p_mode: "watched" });
    expect(error).toBeNull();
    for (const r of data ?? []) {
      expect(r).toHaveProperty("marketplace");
      expect(r).toHaveProperty("is_flash_sale");
    }
  });

  it("price_drop_radar carries the same two columns", async () => {
    const { data, error } = await admin.rpc("price_drop_radar", { p_min_drop: 0 });
    expect(error).toBeNull();
    for (const r of data ?? []) {
      expect(r).toHaveProperty("marketplace");
      expect(r).toHaveProperty("is_flash_sale");
    }
  });

  it("anon can still call all three", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    });
    for (const [fn, args] of [
      ["search_products", { p_q: tag }],
      ["trending_products", { p_mode: "rising" }],
      ["price_drop_radar", {}],
    ] as const) {
      const { error } = await anon.rpc(fn, args as never);
      expect(error, fn).toBeNull();
    }
  });
});
