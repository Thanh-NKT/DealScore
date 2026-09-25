import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

const tag = randomUUID().slice(0, 8);
const productIds: string[] = [];
const users: TestUser[] = [];
let categoryId: string;

const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.parse(`${vnToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** A product with 20 days of history at `median` and a current price. Returns ids. */
async function product(opts: { price: number; median: number; inStock?: boolean; status?: "verified" | "draft"; original?: number }) {
  const { data: p, error } = await admin
    .from("products")
    .insert({
      canonical_name: `Disc ${tag}`,
      slug: `test-disc-${tag}-${productIds.length}`,
      status: opts.status ?? "verified",
      category_id: categoryId,
    })
    .select("id")
    .single();
  if (error) throw error;
  productIds.push(p.id);
  const { data: v } = await admin.from("product_variants").insert({ product_id: p.id, variant_key: "x" }).select("id").single();
  await admin.from("variant_daily_prices").insert(
    Array.from({ length: 20 }, (_, i) => ({
      variant_id: v!.id,
      day: daysAgo(i + 1),
      min_price: opts.median,
      median_price: opts.median,
      max_price: opts.median,
      obs_count: 1,
      offer_count: 1,
    })),
  );
  await admin.from("variant_current_price").insert({
    variant_id: v!.id,
    price: opts.price,
    original_price: opts.original ?? null,
    in_stock: opts.inStock ?? true,
    offer_count: 1,
    observed_at: new Date().toISOString(),
  });
  return { productId: p.id, variantId: v!.id };
}

beforeAll(async () => {
  const { data } = await admin.from("categories").insert({ slug: `test-disc-${tag}`, name: "Test disc" }).select("id").single();
  categoryId = data!.id;
});

afterAll(async () => {
  await admin.from("products").delete().in("id", productIds);
  await admin.from("categories").delete().eq("id", categoryId);
  for (const u of users) await deleteTestUser(u.id);
});

describe("price_drop_radar", () => {
  it("lists real drops vs the 30-day median, deepest first; never drafts, out-of-stock or list-price-only deals", async () => {
    const deep = await product({ price: 700_000, median: 1_000_000 });
    const mild = await product({ price: 880_000, median: 1_000_000 });
    await product({ price: 950_000, median: 1_000_000 }); // −5%: under the threshold
    await product({ price: 1_000_000, median: 1_000_000, original: 2_000_000 }); // "−50%" vs list price only
    await product({ price: 500_000, median: 1_000_000, status: "draft" });
    await product({ price: 500_000, median: 1_000_000, inStock: false });

    const { data, error } = await admin.rpc("price_drop_radar", { p_category_id: categoryId });
    expect(error).toBeNull();
    expect(data!.map((r) => r.product_id)).toEqual([deep.productId, mild.productId]);
    expect(Number(data![0].drop_pct)).toBeCloseTo(0.3);
    expect(Number(data![0].median_30d)).toBe(1_000_000);
    expect(Number(data![0].total_count)).toBe(2);
  });
});

describe("trending_products", () => {
  it("most watched needs ≥ 2 active Watches and returns counts only", async () => {
    const popular = await product({ price: 900_000, median: 1_000_000 });
    const lonely = await product({ price: 900_000, median: 1_000_000 });
    for (let i = 0; i < 3; i++) users.push(await createTestUser());
    for (const u of users.slice(0, 2)) {
      const { error } = await u.client.from("watches").insert({ variant_id: popular.variantId, target_price: 800_000 });
      if (error) throw error;
    }
    await users[2].client.from("watches").insert({ variant_id: lonely.variantId, target_price: 800_000 });

    const { data, error } = await users[2].client.rpc("trending_products", { p_mode: "watched", p_category_id: categoryId });
    expect(error).toBeNull();
    expect(data!.map((r) => r.product_id)).toEqual([popular.productId]);
    expect(data![0].watch_count).toBe(2);
    expect(Object.keys(data![0])).not.toContain("user_id");
  });

  it("rising = more views this week than last, with at least 3 views", async () => {
    const hot = await product({ price: 900_000, median: 1_000_000 });
    const cold = await product({ price: 900_000, median: 1_000_000 });
    const at = (daysBack: number) => new Date(Date.now() - daysBack * 86_400_000).toISOString();
    const view = (productId: string, daysBack: number) => ({
      name: "product_viewed" as const,
      props: { product_id: productId },
      created_at: at(daysBack),
    });
    await admin.from("analytics_events").insert([
      view(hot.productId, 1), view(hot.productId, 2), view(hot.productId, 3), view(hot.productId, 4),
      view(hot.productId, 9),
      view(cold.productId, 1), view(cold.productId, 2), view(cold.productId, 3),
      view(cold.productId, 8), view(cold.productId, 9), view(cold.productId, 10), view(cold.productId, 11),
    ]);

    const { data, error } = await admin.rpc("trending_products", { p_mode: "rising", p_category_id: categoryId });
    expect(error).toBeNull();
    expect(data!.map((r) => r.product_id)).toEqual([hot.productId]);
    expect(data![0]).toMatchObject({ views_7d: 4, views_prev_7d: 1 });
    await admin.from("analytics_events").delete().in("props->>product_id", [hot.productId, cold.productId]);
  });

  it("rejects an unknown mode", async () => {
    const { error } = await admin.rpc("trending_products", { p_mode: "nope" });
    expect(error).not.toBeNull();
  });
});
