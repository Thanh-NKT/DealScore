import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// admin_marketplace_health / admin_freshness / admin_stale_offers / admin_overview_counts(p_stale_hours) (0033).
// Fake marketplace ids keep the assertions independent of the dev seed (listings.marketplace has no check).
const tag = `hl${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const mk = `t${tag}`;
const mkListingsOnly = `u${tag}`;
const mkBad = `b${tag}`;
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Res = { data: any; error: { message: string } | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => admin.rpc(fn as never, args as never) as unknown as Promise<Res>;

let user: TestUser;
let productId: string;
let variantA: string;
let variantWatched: string;
const listingIds: Record<string, string> = {};
const offerIds: Record<string, string> = {};
const runIds: string[] = [];
// Start of the UTC hour 3 hours ago: every run placed inside it is well within the 24 h window.
const hourStart = Math.floor((Date.now() - 3 * HOUR) / HOUR) * HOUR;

async function listing(key: string, marketplace: string, row: Record<string, unknown>) {
  const { data, error } = await admin.from("listings")
    .insert({ marketplace, external_item_id: `${tag}-${key}`, title: `Tin ${key}`, url: `https://x.vn/${tag}/${key}`, ...row } as never)
    .select("id").single();
  if (error) throw error;
  listingIds[key] = data!.id;
}
async function offer(key: string, listingKey: string, variantId: string, matchStatus: string) {
  const { data, error } = await admin.from("offers")
    .insert({ listing_id: listingIds[listingKey], variant_id: variantId, match_status: matchStatus, external_model_id: key })
    .select("id").single();
  if (error) throw error;
  offerIds[key] = data!.id;
}
async function run(startedAt: number, perMarketplace: unknown, errorSummary: string | null) {
  const { data, error } = await admin.from("collector_runs").insert({
    source: "test", started_at: new Date(startedAt).toISOString(), finished_at: new Date(startedAt + 2 * MIN).toISOString(),
    per_marketplace: perMarketplace as never, error_summary: errorSummary,
  }).select("id").single();
  if (error) throw error;
  runIds.push(data!.id);
}

beforeAll(async () => {
  user = await createTestUser();
  const { data: p, error } = await admin.from("products")
    .insert({ canonical_name: `Health ${tag}`, brand: "B", status: "verified", slug: `test-${tag}` }).select("id").single();
  if (error) throw error;
  productId = p!.id;
  const { data: vs } = await admin.from("product_variants")
    .insert([{ product_id: productId, variant_key: "A" }, { product_id: productId, variant_key: "W" }]).select("id, variant_key");
  variantA = vs!.find((v) => v.variant_key === "A")!.id;
  variantWatched = vs!.find((v) => v.variant_key === "W")!.id;

  await listing("fresh14", mk, { last_observed_at: iso(14 * MIN) });
  await listing("edge15", mk, { last_observed_at: iso(15 * MIN) });
  await listing("old", mk, { last_observed_at: iso(72 * HOUR) });
  await listing("failing", mk, { last_observed_at: iso(72 * HOUR), last_attempt_at: iso(HOUR) });
  await listing("never", mk, { last_observed_at: null, refresh_priority: 1 });
  await listing("inactive", mk, { status: "inactive", last_observed_at: iso(72 * HOUR) });
  await listing("other", mkListingsOnly, { last_observed_at: iso(HOUR) });

  await offer("o-fresh", "fresh14", variantA, "auto");
  await offer("o-old", "old", variantA, "auto");
  await offer("o-old-rejected", "old", variantA, "rejected");
  await offer("o-failing", "failing", variantWatched, "manual");
  await offer("o-never", "never", variantA, "auto");
  await offer("o-inactive", "inactive", variantA, "auto");
  const { error: wErr } = await admin.from("watches")
    .insert({ user_id: user.id, variant_id: variantWatched, product_id: productId, target_price: 1000 });
  if (wErr) throw wErr;

  await run(hourStart + 10 * MIN, { [mk]: { ok: 10, failed: 1, aborted: false } }, "lỗi A");
  await run(hourStart + 20 * MIN, { [mk]: { ok: 5, failed: 2, aborted: true } }, "lỗi B");
  await run(hourStart + 30 * MIN, { [mk]: { ok: 1, failed: 0, aborted: false } }, null);
  await run(hourStart + 40 * MIN, null, "no per_marketplace");
  await run(hourStart + 45 * MIN, { [mk]: 5 }, "not an object");
  // 0037: malformed counters in one entry must not break the whole RPC.
  await run(hourStart + 50 * MIN, { [mkBad]: { ok: "x", failed: 2.7, aborted: "nope" } }, null);
  await run(hourStart + 51 * MIN, { [mkBad]: { ok: 1e12, failed: -3, aborted: true } }, null);
  await run(Date.now() - 30 * HOUR, { [mk]: { ok: 100, failed: 100, aborted: true } }, "outside the window");
});

afterAll(async () => {
  if (runIds.length) await admin.from("collector_runs").delete().in("id", runIds);
  await admin.from("listings").delete().in("marketplace", [mk, mkListingsOnly]);
  await admin.from("products").delete().eq("id", productId);
  await deleteTestUser(user.id);
});

describe("admin_marketplace_health", () => {
  it("adds up runs per marketplace inside the window and skips null / non-object stats", async () => {
    const r = await rpc("admin_marketplace_health", {});
    expect(r.error).toBeNull();
    expect(Date.parse(r.data.since)).toBeGreaterThan(Date.now() - 24 * HOUR - MIN);
    const row = (r.data.marketplaces as { marketplace: string }[]).find((m) => m.marketplace === mk);
    expect(row).toEqual({
      marketplace: mk, listings_active: 5, listings_inactive: 1, listings_failing: 1, listings_stale: 3,
      items_ok: 16, items_failed: 3, runs: 3, aborted_runs: 1,
      last_run_at: expect.any(String),
    });
    expect(Date.parse((row as unknown as { last_run_at: string }).last_run_at)).toBe(hourStart + 32 * MIN);
  });

  it("survives malformed counters: non-numbers / out of range → 0, fractions truncated, non-boolean aborted → false", async () => {
    const r = await rpc("admin_marketplace_health", {});
    expect(r.error).toBeNull();
    expect((r.data.marketplaces as { marketplace: string }[]).find((m) => m.marketplace === mkBad)).toMatchObject({
      items_ok: 0, items_failed: 2, runs: 2, aborted_runs: 1,
    });
  });

  it("lists a marketplace that only has listings", async () => {
    const r = await rpc("admin_marketplace_health", {});
    expect((r.data.marketplaces as { marketplace: string }[]).find((m) => m.marketplace === mkListingsOnly)).toEqual({
      marketplace: mkListingsOnly, listings_active: 1, listings_inactive: 0, listings_failing: 0, listings_stale: 0,
      items_ok: 0, items_failed: 0, runs: 0, aborted_runs: 0, last_run_at: null,
    });
  });

  it("groups hourly, newest error sample in the hour", async () => {
    const r = await rpc("admin_marketplace_health", { p_hours: 24 });
    const hours = (r.data.hourly as { marketplace: string; hour: string }[]).filter((h) => h.marketplace === mk);
    expect(hours).toHaveLength(1);
    expect(Date.parse(hours[0].hour)).toBe(hourStart);
    expect(hours[0]).toMatchObject({ ok: 16, failed: 3, aborted: true, error_sample: "lỗi B" });
    // A 1-hour window no longer reaches runs from 3 hours ago.
    const short = await rpc("admin_marketplace_health", { p_hours: 1 });
    expect((short.data.hourly as { marketplace: string }[]).filter((h) => h.marketplace === mk)).toEqual([]);
    expect((short.data.marketplaces as { marketplace: string; runs: number }[]).find((m) => m.marketplace === mk)?.runs).toBe(0);
  });

  it("p_hours 0 is clamped to 1 and p_stale_hours moves the stale cut-off", async () => {
    const r = await rpc("admin_marketplace_health", { p_hours: 0, p_stale_hours: 1 });
    expect(r.error).toBeNull();
    expect(Date.parse(r.data.since)).toBeGreaterThan(Date.now() - HOUR - MIN);
    expect((r.data.marketplaces as { marketplace: string; listings_stale: number }[])
      .find((m) => m.marketplace === mk)?.listings_stale).toBe(3);
    const loose = await rpc("admin_marketplace_health", { p_stale_hours: 100 });
    expect((loose.data.marketplaces as { marketplace: string; listings_stale: number }[])
      .find((m) => m.marketplace === mk)?.listings_stale).toBe(1);
  });
});

describe("admin_freshness", () => {
  it("buckets active listings by age; null = -1; the 15-minute edge falls in bucket 1", async () => {
    const r = await rpc("admin_freshness", {});
    expect(r.error).toBeNull();
    const mine = (r.data.buckets as { marketplace: string; bucket: number; listings: number }[])
      .filter((b) => b.marketplace === mk)
      .sort((a, b) => a.bucket - b.bucket);
    expect(mine).toEqual([
      { marketplace: mk, bucket: -1, listings: 1 },
      { marketplace: mk, bucket: 0, listings: 1 },
      { marketplace: mk, bucket: 1, listings: 1 },
      { marketplace: mk, bucket: 5, listings: 2 },
    ]);
    expect((r.data.stale_offers as { marketplace: string; offers: number }[]).find((s) => s.marketplace === mk))
      .toEqual({ marketplace: mk, offers: 3 });
    const p1 = (r.data.by_priority as { refresh_priority: number; listings: number }[]).find((p) => p.refresh_priority === 1);
    expect(p1?.listings).toBeGreaterThanOrEqual(1);
  });

  it("uses custom edges", async () => {
    const r = await rpc("admin_freshness", { p_edges_minutes: [60] });
    const mine = (r.data.buckets as { marketplace: string; bucket: number; listings: number }[])
      .filter((b) => b.marketplace === mk).sort((a, b) => a.bucket - b.bucket);
    expect(mine.map((b) => [b.bucket, b.listings])).toEqual([[-1, 1], [0, 2], [1, 2]]);
  });

  it("rejects bad edges", async () => {
    for (const edges of [[60, 15], [15, 15], [], [0, 15], Array.from({ length: 11 }, (_, i) => i + 1)]) {
      const r = await rpc("admin_freshness", { p_edges_minutes: edges });
      expect(r.error?.message, JSON.stringify(edges)).toContain("admin_freshness: mốc không hợp lệ");
    }
  });
});

describe("admin_stale_offers", () => {
  it("lists visible offers with stale listings, watched first, then oldest", async () => {
    const r = await rpc("admin_stale_offers", { p_marketplace: mk });
    expect(r.error).toBeNull();
    const rows = r.data as Record<string, unknown>[];
    expect(rows.map((x) => x.offer_id)).toEqual([offerIds["o-failing"], offerIds["o-never"], offerIds["o-old"]]);
    expect(rows[0]).toMatchObject({
      listing_id: listingIds.failing, marketplace: mk, listing_title: "Tin failing", url: `https://x.vn/${tag}/failing`,
      product_id: productId, product_name: `Health ${tag}`, product_status: "verified", product_slug: `test-${tag}`,
      failing: true, watched: true, total_count: 3,
    });
    expect(rows[1]).toMatchObject({ failing: false, watched: false, last_observed_at: null });
  });

  it("pages with total_count and clamps p_limit", async () => {
    const one = await rpc("admin_stale_offers", { p_marketplace: mk, p_limit: 1, p_offset: 1 });
    expect((one.data as { offer_id: string; total_count: number }[]).map((x) => [x.offer_id, x.total_count]))
      .toEqual([[offerIds["o-never"], 3]]);
    const zero = await rpc("admin_stale_offers", { p_marketplace: mk, p_limit: 0 });
    expect(zero.data).toHaveLength(1);
    const fresh = await rpc("admin_stale_offers", { p_marketplace: mk, p_stale_hours: 200 });
    expect((fresh.data as { offer_id: string }[]).map((x) => x.offer_id)).toEqual([offerIds["o-never"]]);
  });
});

describe("admin_overview_counts", () => {
  it("still works without arguments and adds stale_listings", async () => {
    const r = await rpc("admin_overview_counts");
    expect(r.error).toBeNull();
    for (const k of ["drafts_multi_shop", "drafts_single", "pending_matches", "failing_listings", "cron_failures_24h",
      "last_collector_at", "tiktok_access_expires_at", "stale_listings"]) {
      expect(r.data, k).toHaveProperty(k);
    }
    expect(r.data.stale_listings).toBeGreaterThanOrEqual(3);
    const strict = await rpc("admin_overview_counts", { p_stale_hours: 1 });
    expect(strict.data.stale_listings).toBeGreaterThanOrEqual(r.data.stale_listings + 0);
  });
});

describe("health privileges", () => {
  it("authenticated cannot call the health RPCs", async () => {
    for (const fn of ["admin_marketplace_health", "admin_freshness", "admin_stale_offers", "admin_overview_counts"]) {
      const { error } = await user.client.rpc(fn as never);
      expect(error, fn).not.toBeNull();
    }
  });
});
