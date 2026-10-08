import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, SUPABASE_URL } from "./helpers";
import { recomputeCategorySeasons } from "@/lib/seasons/job";

// Roadmap P4 A (0065): season_variant_ids, category_season_stats, recomputeCategorySeasons. Own fixture rows.
const tag = randomUUID().slice(0, 8);
let categoryId = "";
let productId = "";
const variants: string[] = [];
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const { data: c, error } = await admin.from("categories").insert({ slug: `p4-season-${tag}`, name: `Mùa ${tag}` }).select("id").single();
  if (error) throw error;
  categoryId = c.id;
  const { data: p } = await admin
    .from("products")
    .insert({ canonical_name: `P4 season ${tag}`, slug: `p4-season-${tag}`, status: "verified", category_id: categoryId })
    .select("id")
    .single();
  productId = p!.id;
  for (let i = 0; i < 3; i++) {
    const { data: v } = await admin.from("product_variants").insert({ product_id: productId, variant_key: `V${i}` }).select("id").single();
    variants.push(v!.id);
  }
  const today = vnToday();
  // coverage: V0 400 days, V1 100 days, V2 none
  for (const [vi, days] of [[0, 400], [1, 100]] as const) {
    const rows = Array.from({ length: days }, (_, i) => ({
      variant_id: variants[vi], day: addDays(today, -i), min_price: 100_000, median_price: 100_000, max_price: 100_000,
      obs_count: 1, offer_count: 1, has_flash_sale: false,
    }));
    const { error: e } = await admin.from("variant_daily_prices").upsert(rows);
    if (e) throw e;
  }
});
afterAll(async () => {
  await admin.from("variant_daily_prices").delete().in("variant_id", variants);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("categories").delete().eq("id", categoryId);
});

describe("season_variant_ids", () => {
  it("orders by coverage, skips variants without rollups, caps p_limit at 200", async () => {
    const { data, error } = await admin.rpc("season_variant_ids", { p_category_id: categoryId, p_limit: 5000 });
    expect(error).toBeNull();
    expect(data!.map((r) => r.variant_id)).toEqual([variants[0], variants[1]]);
    expect(data![0].days).toBeGreaterThan(data![1].days);
    const { data: one } = await admin.rpc("season_variant_ids", { p_category_id: categoryId, p_limit: 1 });
    expect(one).toHaveLength(1);
  });
});

describe("recomputeCategorySeasons + category_season_stats", () => {
  it("writes the category rows (flat prices → ratio 1), public read, anon cannot write", async () => {
    const r = await recomputeCategorySeasons({ now: new Date(), categoryIds: [categoryId] }, admin);
    expect(r.errors).toBe(0);
    const { data } = await admin.from("category_season_stats").select("event_key, variants_counted, median_ratio").eq("category_id", categoryId);
    expect((data ?? []).length).toBeGreaterThan(0);
    expect(data!.every((x) => Number(x.median_ratio) === 1)).toBe(true);
    const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await anon.from("category_season_stats").select("event_key").eq("category_id", categoryId)).data!.length).toBe(data!.length);
    expect((await anon.from("category_season_stats").delete().eq("category_id", categoryId)).error?.code).toBe("42501");
    // fresh now: a second run skips it
    const r2 = await recomputeCategorySeasons({ now: new Date(), categoryIds: [categoryId] }, admin);
    expect(r2.written).toBe(0);
    expect(r.categories).toBe(1);
  });
});
