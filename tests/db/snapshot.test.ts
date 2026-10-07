import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { toVnDate } from "@/lib/format";
import { loadVariantSnapshots } from "@/lib/watch/snapshot";
import { admin } from "./helpers";

const tag = `snap${randomUUID().replace(/-/g, "").slice(0, 8)}`;
afterAll(async () => {
  await admin.from("products").delete().eq("slug", `test-${tag}`);
});

describe("loadVariantSnapshots", () => {
  it("reads the full 90-day rollup for 25 variants (over the 1000-row cap without batching)", async () => {
    const { data } = await admin.from("variant_current_price").select("variant_id").not("price", "is", null).limit(25);
    const ids = (data ?? []).map((r) => r.variant_id);
    const now = new Date();
    const snaps = await loadVariantSnapshots(admin, ids, now);
    expect(snaps.size).toBe(ids.length);
    // Seed has 120 days of data → most variants meet the scoring threshold.
    const scored = [...snaps.values()].filter((s) => s.deal?.score != null);
    expect(scored.length).toBeGreaterThan(0);
  });

  it("variant missing from variant_current_price → stale, no price", async () => {
    const snaps = await loadVariantSnapshots(admin, ["00000000-0000-0000-0000-000000000001"], new Date());
    expect(snaps.get("00000000-0000-0000-0000-000000000001")).toMatchObject({
      price: null,
      inStock: false,
      isStale: true,
      deal: null,
    });
  });

  it("price7dAgo = min_price of day −7 from the loaded rollup; null without a current price", async () => {
    const { data: p } = await admin.from("products")
      .insert({ canonical_name: `Snap ${tag}`, status: "verified", slug: `test-${tag}` }).select("id").single();
    const { data: vs } = await admin.from("product_variants")
      .insert([{ product_id: p!.id, variant_key: "A" }, { product_id: p!.id, variant_key: "B" }]).select("id, variant_key");
    const a = vs!.find((v) => v.variant_key === "A")!.id;
    const b = vs!.find((v) => v.variant_key === "B")!.id;
    const now = new Date();
    const day = (k: number) => toVnDate(new Date(now.getTime() - k * 86_400_000));
    const rows = Array.from({ length: 10 }, (_, k) => ({
      variant_id: a, day: day(k), min_price: 1_000_000 + k * 1000, median_price: 1_000_000 + k * 1000,
      max_price: 1_000_000 + k * 1000, obs_count: 1, offer_count: 1,
    }));
    const { error } = await admin.from("variant_daily_prices").insert([...rows, { ...rows[7], variant_id: b }]);
    expect(error).toBeNull();
    await admin.from("variant_current_price").insert({ variant_id: a, price: 990_000, observed_at: now.toISOString() });
    const snaps = await loadVariantSnapshots(admin, [a, b], now);
    expect(snaps.get(a)?.price7dAgo).toBe(1_007_000);
    expect(snaps.get(b)?.price7dAgo).toBeNull();
  });
});
