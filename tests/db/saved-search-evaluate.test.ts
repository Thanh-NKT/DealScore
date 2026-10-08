import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";
import { createFixtureCatalog, type FixtureCatalog } from "./fixtures";
import { evaluateSavedSearches } from "@/lib/saved-search/evaluate";

// P4 review I1 (queue starvation) and I2 (baseline = every product matching at save time), end to end through
// search_products + record_saved_search_evaluation. Every pass is scoped to this file's ids.
const users: TestUser[] = [];
let cat: FixtureCatalog;
beforeAll(async () => {
  cat = await createFixtureCatalog("sse");
});
afterAll(async () => {
  for (const u of users) await deleteTestUser(u.id);
  await cat.cleanup();
});
async function user() {
  const u = await createTestUser();
  users.push(u);
  return u;
}
async function save(u: TestUser, params: Record<string, unknown>, channels: string[] | null = null) {
  const { data, error } = await u.client
    .from("saved_searches")
    .insert({ name: "Fixture", params: params as never, channels })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}
const H = 3_600_000;
const row = async (id: string) =>
  (await admin.from("saved_searches").select("initialized_at, last_evaluated_at").eq("id", id).single()).data!;
const events = async (id: string) =>
  (await admin.from("alert_events").select("items").eq("saved_search_id", id)).data ?? [];
/** Make a search due again (the interval is 6 h). */
const makeDue = (id: string, now: Date) =>
  admin.from("saved_searches").update({ last_evaluated_at: new Date(now.getTime() - 7 * H).toISOString() }).eq("id", id);

describe("evaluateSavedSearches: queue (I1)", () => {
  it("21 channel-less searches never starve a normal one; skipped rows move their cursor, write no hits", async () => {
    await cat.product({ price: 100_000 });
    const owners = [await user(), await user(), await user()];
    const silent: string[] = [];
    for (let i = 0; i < 21; i++) {
      // channels ['push'] and push off by default → no channel.
      silent.push(await save(owners[i % 3], { categorySlug: cat.categorySlug, maxPrice: 1_000 + i }, ["push"]));
    }
    // Already baselined (the "skip" path), never evaluated: they head the queue (nulls first).
    const t0 = new Date(Date.now() - 24 * H).toISOString();
    await admin.from("saved_searches").update({ initialized_at: t0, last_evaluated_at: null }).in("id", silent);
    const normal = await save(await user(), { categorySlug: cat.categorySlug, maxPrice: 5_000_000 });
    const now = new Date();
    await makeDue(normal, now);
    const ids = [...silent, normal];

    const first = await evaluateSavedSearches({ now, ids });
    expect(first).toMatchObject({ skipped: 20, evaluated: 0, errors: 0 });
    const second = await evaluateSavedSearches({ now, ids });
    expect(second).toMatchObject({ skipped: 1, evaluated: 1, errors: 0 });
    expect((await row(normal)).initialized_at).not.toBeNull();

    // Skipped: cursor moved, baseline untouched, no hits written.
    const { data: s } = await admin.from("saved_searches").select("initialized_at, last_evaluated_at").in("id", silent);
    for (const r of s!) {
      expect(Date.parse(r.last_evaluated_at!)).toBe(now.getTime());
      expect(Date.parse(r.initialized_at!)).toBe(Date.parse(t0));
    }
    const { count } = await admin.from("saved_search_hits").select("product_id", { count: "exact", head: true }).in("saved_search_id", silent);
    expect(count).toBe(0);
    // Nothing is due any more.
    expect(await evaluateSavedSearches({ now, ids })).toMatchObject({ skipped: 0, evaluated: 0 });
  });

  it("a channel-less search that was never baselined is baselined (it can never alert)", async () => {
    const id = await save(await user(), { categorySlug: cat.categorySlug, maxPrice: 5_000_000 }, ["push"]);
    expect(await evaluateSavedSearches({ now: new Date(), ids: [id] })).toMatchObject({ evaluated: 1, alerts: 0 });
    expect((await row(id)).initialized_at).not.toBeNull();
    expect(await events(id)).toEqual([]);
  });
});

describe("evaluateSavedSearches: baseline (I2)", () => {
  it("S5/S6: > 48 matches and a stale match are all baseline; the cheapest leaving or the stale one refreshing never alerts", async () => {
    const big = await createFixtureCatalog("sse-big");
    try {
      for (let i = 0; i < 60; i++) await big.product({ price: 200_000 + i * 1_000 });
      const stale = await big.product({ price: 150_000, observedHoursAgo: 50 });
      const id = await save(await user(), { categorySlug: big.categorySlug, maxPrice: 5_000_000 });

      let now = new Date();
      expect(await evaluateSavedSearches({ now, ids: [id] })).toMatchObject({ evaluated: 1, alerts: 0 });
      const { count } = await admin
        .from("saved_search_hits")
        .select("product_id", { count: "exact", head: true })
        .eq("saved_search_id", id)
        .eq("in_set", true);
      expect(count).toBe(61);

      // The 12 cheapest go over the ceiling → what used to be #49+ shows up in the first 48.
      const cheapest = big.products.filter((p) => p.productId !== stale.productId).slice(0, 12);
      await admin.from("variant_current_price").update({ price: 9_000_000 }).in("variant_id", cheapest.map((p) => p.variantId));
      // The stale match is observed again.
      await admin.from("variant_current_price").update({ observed_at: new Date().toISOString() }).eq("variant_id", stale.variantId);
      now = new Date(now.getTime() + 7 * H);
      await makeDue(id, now);
      expect(await evaluateSavedSearches({ now, ids: [id] })).toMatchObject({ evaluated: 1, alerts: 0, errors: 0 });
      expect(await events(id)).toEqual([]);

      // Sanity: a genuinely new product still alerts, alone.
      const fresh = await big.product({ price: 100_000 });
      now = new Date(now.getTime() + 7 * H);
      await makeDue(id, now);
      expect(await evaluateSavedSearches({ now, ids: [id] })).toMatchObject({ alerts: 1 });
      const ev = await events(id);
      expect(ev).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((ev[0].items as any[]).map((i) => i.product_id)).toEqual([fresh.productId]);
    } finally {
      await big.cleanup();
    }
  });
});

describe("evaluateSavedSearches: params edit (final review I1)", () => {
  it("an edit made right after an evaluation is baselined at once; the next new product alerts, alone", async () => {
    const c = await createFixtureCatalog("sse-edit");
    try {
      await c.product({ price: 100_000 });
      const u = await user();
      const id = await save(u, { categorySlug: c.categorySlug, maxPrice: 5_000_000 });
      let now = new Date();
      expect(await evaluateSavedSearches({ now, ids: [id] })).toMatchObject({ evaluated: 1, alerts: 0 });

      // The owner lowers the ceiling minutes later (well inside the 6 h interval): the save action's baseline.
      const { error } = await u.client
        .from("saved_searches")
        .update({ params: { categorySlug: c.categorySlug, maxPrice: 3_000_000 } as never })
        .eq("id", id);
      expect(error).toBeNull();
      expect((await row(id)).last_evaluated_at).toBeNull();
      now = new Date(now.getTime() + 5 * 60_000);
      expect(await evaluateSavedSearches({ now, ids: [id] })).toMatchObject({ evaluated: 1, alerts: 0 });
      expect((await row(id)).initialized_at).not.toBeNull();

      // A product entering after the edit is news, not baseline.
      const fresh = await c.product({ price: 200_000 });
      now = new Date(now.getTime() + 7 * H);
      expect(await evaluateSavedSearches({ now, ids: [id] })).toMatchObject({ evaluated: 1, alerts: 1 });
      const ev = await events(id);
      expect(ev).toHaveLength(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((ev[0].items as any[]).map((i) => i.product_id)).toEqual([fresh.productId]);
    } finally {
      await c.cleanup();
    }
  });

  it("a name / status / channels change keeps the cursor (not a re-baseline)", async () => {
    const u = await user();
    const id = await save(u, { categorySlug: cat.categorySlug, maxPrice: 5_000_000 });
    const now = new Date();
    await evaluateSavedSearches({ now, ids: [id] });
    await u.client.from("saved_searches").update({ name: "Đổi tên" }).eq("id", id);
    expect(Date.parse((await row(id)).last_evaluated_at!)).toBe(now.getTime());
  });
});
