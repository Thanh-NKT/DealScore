import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { listMyWatches } from "@/lib/watch/queries";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { seedVariantWithHistory, type SeededVariant } from "./seed-history";

// Migration 0040: purchase snapshot when a watch moves to 'done'.
const created: TestUser[] = [];
async function user() {
  const u = await createTestUser();
  created.push(u);
  return u;
}
afterEach(async () => {
  while (created.length) await deleteTestUser(created.pop()!.id);
});

let inStock: SeededVariant;
let outOfStock: SeededVariant;
beforeAll(async () => {
  // Days 1..20 ago: 1,000,000 + daysAgo × 10,000 → median of 20 values = 1,105,000. Day 0 (today) is not seeded
  // through the helper, so it is added below at a price that would move the median if it were counted.
  inStock = await seedVariantWithHistory({ price: 900_000, days: 20, daily: (d) => 1_000_000 + d * 10_000 });
  await admin.from("variant_daily_prices").upsert({
    variant_id: inStock.variantId,
    day: new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10),
    min_price: 1,
    median_price: 1,
    max_price: 1,
    obs_count: 1,
    offer_count: 1,
  });
  outOfStock = await seedVariantWithHistory({ price: 900_000, inStock: false, days: 20, daily: () => 1_000_000 });
});
afterAll(async () => {
  await inStock.cleanup();
  await outOfStock.cleanup();
});

async function watch(u: TestUser, variantId: string) {
  const { data, error } = await u.client.from("watches").insert({ variant_id: variantId, notify_low: true }).select("id").single();
  if (error) throw error;
  return data.id;
}
const read = (id: string) =>
  admin
    .from("watches")
    .select("purchased_at, purchased_price, purchased_median_30d, purchased_median_days")
    .eq("id", id)
    .single()
    .then((r) => r.data!);

describe("watches_capture_purchase (0040)", () => {
  it("done → current price + 30-day median (today excluded); back to active clears", async () => {
    const u = await user();
    const id = await watch(u, inStock.variantId);
    expect((await u.client.from("watches").update({ status: "done" }).eq("id", id)).error).toBeNull();
    const done = await read(id);
    expect(done.purchased_at).not.toBeNull();
    expect(Number(done.purchased_price)).toBe(900_000);
    expect(Number(done.purchased_median_30d)).toBe(1_105_000);
    expect(done.purchased_median_days).toBe(20);

    const items = await listMyWatches(u.id, new Date(), u.client);
    expect(items[0].purchase).toMatchObject({ status: "saved", vsMedian: 205_000, purchasedPrice: 900_000 });

    await u.client.from("watches").update({ status: "active" }).eq("id", id);
    expect(await read(id)).toEqual({ purchased_at: null, purchased_price: null, purchased_median_30d: null, purchased_median_days: null });
  });

  it("out of stock → purchased_price null (median still captured)", async () => {
    const u = await user();
    const id = await watch(u, outOfStock.variantId);
    await u.client.from("watches").update({ status: "done" }).eq("id", id);
    const done = await read(id);
    expect(done.purchased_price).toBeNull();
    expect(Number(done.purchased_median_30d)).toBe(1_000_000);
  });

  it("paused → done also captures", async () => {
    const u = await user();
    const id = await watch(u, inStock.variantId);
    await u.client.from("watches").update({ status: "paused" }).eq("id", id);
    await u.client.from("watches").update({ status: "done" }).eq("id", id);
    expect(Number((await read(id)).purchased_price)).toBe(900_000);
  });

  it("a user cannot write the purchase columns", async () => {
    const u = await user();
    const id = await watch(u, inStock.variantId);
    const { error } = await u.client.from("watches").update({ purchased_price: 1 }).eq("id", id);
    expect(error?.code).toBe("42501");
  });
});
