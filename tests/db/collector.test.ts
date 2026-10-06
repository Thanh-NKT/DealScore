import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST_PROCESSING_RESERVE_MS, runCollector, type CollectorDeps } from "@/lib/collector/run";
import {
  MarketplaceItemGoneError,
  MarketplaceItemNotFoundError,
  MarketplaceUnavailableError,
  type MarketplaceItem,
} from "@/lib/marketplaces/types";
import type { CollectorListing } from "@/lib/collector/schedule";
import { effectivePriceFor } from "@/lib/vouchers/effective";
import { listVouchersForListing } from "@/lib/vouchers/store";
import { admin } from "./helpers";

const tag = randomUUID().slice(0, 8);
const extIds: string[] = [];
const runIds: string[] = [];
let productId: string;
let variantId: string;

async function makeListing(price: number): Promise<CollectorListing> {
  const ext = `9${tag}_${randomUUID()}`;
  extIds.push(ext);
  const { error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: ext,
      url: `https://shopee.vn/product/1/2`,
      title: "Collector test",
      slug_base: `test-collector-${tag}`,
      source: "seed",
      seller: { external_id: `seller-${tag}`, name: "Test" },
      models: [{ model_id: "m1", name: "2TB", price, stock: 5, match: { variant_id: variantId, confidence: 1, reason: "t" } }],
    },
  });
  if (error) throw error;
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const { data } = await admin
    .from("listings")
    .update({ last_observed_at: old })
    .eq("external_item_id", ext)
    .select("id")
    .single();
  return { id: data!.id, marketplace: "shopee", externalItemId: ext, refreshPriority: 3, lastObservedAt: old, lastAttemptAt: null, watched: false };
}

function detail(price: number | null): MarketplaceItem {
  return {
    marketplace: "shopee",
    externalItemId: "",
    url: "https://shopee.vn/product/1/2",
    title: "Collector test",
    seller: { externalId: `seller-${tag}`, name: null, rating: null, ratingCount: null, isOfficial: false },
    models: [
      { modelId: "m1", name: "2TB", price, originalPrice: null, stock: 5, isFlashSale: false },
      { modelId: "m-new", name: "4TB", price: 5_000_000, originalPrice: null, stock: 1, isFlashSale: false },
    ],
    images: [],
    vouchers: [],
    source: "seed",
  };
}

function deps(listings: CollectorListing[], fetchItem: CollectorDeps["fetchItem"]): Partial<CollectorDeps> {
  return {
    configured: () => true,
    loadCandidates: async () => listings,
    fetchItem,
    evaluate: vi.fn(async () => ({ evaluated: 0, alerts: 0, suppressed: 0, skippedStale: 0, errors: 0 })),
  };
}

beforeAll(async () => {
  const { data: p } = await admin
    .from("products")
    .insert({ canonical_name: "Collector", brand: "Test", model: "C", status: "verified", slug: `test-collector-v-${tag}` })
    .select("id")
    .single();
  productId = p!.id;
  const { data: v } = await admin.from("product_variants").insert({ product_id: productId, variant_key: "2TB" }).select("id").single();
  variantId = v!.id;
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("collector_runs").delete().in("id", runIds);
  await admin.from("products").delete().eq("id", productId);
  await admin.from("sellers").delete().eq("external_seller_id", `seller-${tag}`);
});

describe("collector_candidates", () => {
  it("returns listings with a watched flag", async () => {
    const { data, error } = await admin.rpc("collector_candidates", { p_limit: 3 });
    expect(error).toBeNull();
    for (const r of data ?? []) expect(typeof r.watched).toBe("boolean");
  });
});

describe("runCollector", () => {
  it("skips without a run row when Shopee is not configured", async () => {
    expect(await runCollector({}, admin, { configured: () => false })).toEqual({ skipped: "not_configured" });
  });

  it("records prices, opens unmatched offers for new models, refreshes price + score, evaluates Watches", async () => {
    const l = await makeListing(2_000_000);
    const d = deps([l], async () => detail(1_800_000));
    const r = await runCollector({ limit: 10 }, admin, d);
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    expect(r).toMatchObject({ selected: 1, ok: 1, failed: 0, aborted: false, variants: 1, errorRate: 0 });

    const { data: cur } = await admin.from("variant_current_price").select("price").eq("variant_id", variantId).single();
    expect(Number(cur!.price)).toBe(1_800_000);
    const { data: score } = await admin.from("variant_deal_scores").select("price_at_compute").eq("variant_id", variantId).single();
    expect(Number(score!.price_at_compute)).toBe(1_800_000);

    const { data: newOffer } = await admin
      .from("offers")
      .select("variant_id, match_status")
      .eq("listing_id", l.id)
      .eq("external_model_id", "m-new")
      .single();
    expect(newOffer).toEqual({ variant_id: null, match_status: "pending" });

    const { data: run } = await admin.from("collector_runs").select("*").eq("id", r.runId).single();
    expect(run).toMatchObject({ items_ok: 1, items_failed: 0, error_summary: null });
    expect(run!.finished_at).not.toBeNull();
    expect(d.evaluate).toHaveBeenCalledWith(expect.objectContaining({ variantIds: [variantId] }), admin);

    const { data: obs } = await admin
      .from("price_observations")
      .select("collector_run_id")
      .eq("collector_run_id", r.runId);
    expect(obs).toHaveLength(2);
  });

  it("stores a missing price as an invalid observation", async () => {
    const l = await makeListing(2_000_000);
    const r = await runCollector({}, admin, deps([l], async () => detail(null)));
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    const { data } = await admin
      .from("price_observations")
      .select("is_valid, invalid_reason, offers!inner(external_model_id)")
      .eq("collector_run_id", r.runId)
      .eq("offers.external_model_id", "m1");
    expect(data![0]).toMatchObject({ is_valid: false, invalid_reason: "no_price" });
  });

  it("refreshes the effective price of collected listings from the new price", async () => {
    const l = await makeListing(2_000_000);
    const { data: listing } = await admin.from("listings").select("seller_id").eq("id", l.id).single();
    const { error } = await admin.rpc("upsert_vouchers", {
      p_items: [
        {
          marketplace: "shopee",
          kind: "shop",
          sellerId: listing!.seller_id,
          listingId: l.id,
          code: "",
          discountType: "amount",
          discountValue: 10_000,
          minSpend: 0,
        },
      ],
      p_source: "api",
    });
    expect(error).toBeNull();
    try {
      const r = await runCollector({}, admin, deps([l], async () => detail(1_800_000)));
      if ("skipped" in r) throw new Error("unexpected skip");
      runIds.push(r.runId);
      const { data: offer } = await admin
        .from("offers")
        .select("effective_price")
        .eq("listing_id", l.id)
        .eq("external_model_id", "m1")
        .single();
      // Marketplace-wide seed vouchers may stack on top: compare with the same pure math.
      const scope = { marketplace: "shopee", listingId: l.id, sellerId: listing!.seller_id };
      const now = new Date();
      const want = effectivePriceFor(1_800_000, await listVouchersForListing(admin, { ...scope, now }), { ...scope, now });
      expect(want).not.toBeNull();
      expect(want!).toBeLessThanOrEqual(1_790_000);
      expect(Number(offer!.effective_price)).toBe(want);
    } finally {
      await admin.from("vouchers").delete().eq("listing_id", l.id);
    }
  });

  it("marks a gone item inactive; counts other errors; stops when Shopee is down", async () => {
    const gone = await makeListing(2_000_000);
    const broken = await makeListing(2_000_000);
    const down = await makeListing(2_000_000);
    const never = await makeListing(2_000_000);
    const fetchItem = vi.fn(async (_m: string, ext: string) => {
      if (ext === gone.externalItemId) throw new MarketplaceItemGoneError("gone");
      if (ext === broken.externalItemId) throw new Error("parse error");
      if (ext === down.externalItemId) throw new MarketplaceUnavailableError("503");
      return detail(1_000_000);
    });
    const r = await runCollector({}, admin, deps([gone, broken, down, never], fetchItem));
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    expect(r).toMatchObject({ ok: 1, failed: 2, aborted: true });
    expect(fetchItem).toHaveBeenCalledTimes(3);

    const { data: l } = await admin.from("listings").select("status").eq("id", gone.id).single();
    expect(l!.status).toBe("inactive");
    const { data: run } = await admin.from("collector_runs").select("error_summary").eq("id", r.runId).single();
    expect(run!.error_summary).toContain("parse error");
    expect(run!.error_summary).toContain("shopee unavailable");
  });

  it("one marketplace down does not stop the other; not-found never marks gone", async () => {
    // Created oldest-first: the collector processes the most overdue first, i.e. in creation order.
    const missing = await makeListing(2_000_000);
    const shopeeDown = await makeListing(2_000_000);
    const tiktok = { ...(await makeListing(2_000_000)), marketplace: "tiktok" as const };
    const shopeeSkipped = await makeListing(2_000_000);
    // The listing row itself is shopee; the collector only uses CollectorListing.marketplace to route calls.
    const fetchItem = vi.fn(async (_m: string, ext: string) => {
      if (ext === shopeeDown.externalItemId) throw new MarketplaceUnavailableError("503", { marketplace: "shopee" });
      if (ext === missing.externalItemId) throw new MarketplaceItemNotFoundError("nope");
      return detail(1_500_000);
    });
    const r = await runCollector({}, admin, deps([missing, shopeeDown, tiktok, shopeeSkipped], fetchItem));
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    expect(fetchItem).toHaveBeenCalledTimes(3); // shopeeSkipped never called
    expect(fetchItem).toHaveBeenCalledWith("tiktok", tiktok.externalItemId);
    // shopee: "missing" (not found) + "shopeeDown" (unavailable) = 2 failed, then aborted.
    expect(r.perMarketplace).toEqual({
      shopee: { ok: 0, failed: 2, aborted: true },
      tiktok: { ok: 1, failed: 0, aborted: false },
    });
    expect(r.aborted).toBe(true);
    const { data: l } = await admin.from("listings").select("status").eq("id", missing.id).single();
    expect(l!.status).toBe("active");
    const { data: run } = await admin.from("collector_runs").select("per_marketplace").eq("id", r.runId).single();
    expect(run!.per_marketplace).toEqual(r.perMarketplace);
  });

  it("stops fetching before the deadline, keeping the post-processing reserve; evaluate gets the run deadline", async () => {
    const l = await makeListing(2_000_000);
    const fetchItem = vi.fn(async () => detail(1_900_000));
    const d = deps([l], fetchItem);
    const deadline = Date.now() + POST_PROCESSING_RESERVE_MS - 1_000;
    const r = await runCollector({ deadline }, admin, d);
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    expect(fetchItem).not.toHaveBeenCalled();
    const { data: run } = await admin.from("collector_runs").select("finished_at, pending_variant_ids").eq("id", r.runId).single();
    expect(run!.finished_at).not.toBeNull();
    expect(run!.pending_variant_ids).toBeNull();
  });

  it("re-scores the variants of a killed run and closes its row", async () => {
    const { data: killed } = await admin
      .from("collector_runs")
      .insert({ source: "seed", started_at: new Date(Date.now() - 3_600_000).toISOString(), pending_variant_ids: [variantId] })
      .select("id")
      .single();
    runIds.push(killed!.id);
    const l = await makeListing(2_000_000);
    const d = deps([l], async () => {
      throw new MarketplaceItemNotFoundError("nope"); // this run itself touches no variant
    });
    const r = await runCollector({ deadline: Date.now() + 50_000 }, admin, d);
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    expect(r.variants).toBe(1);
    expect(d.evaluate).toHaveBeenCalledWith(expect.objectContaining({ variantIds: [variantId] }), admin);
    const { data: old } = await admin.from("collector_runs").select("finished_at, error_summary, pending_variant_ids").eq("id", killed!.id).single();
    expect(old!.finished_at).not.toBeNull();
    expect(old!.error_summary).toContain("abandoned");
    expect(old!.pending_variant_ids).toBeNull();
    const { data: mine } = await admin.from("collector_runs").select("pending_variant_ids").eq("id", r.runId).single();
    expect(mine!.pending_variant_ids).toBeNull();
  });

  it("records last_attempt_at on a failed fetch so it does not block the queue; the listing stays active", async () => {
    const missing = await makeListing(2_000_000);
    const before = Date.now();
    const r = await runCollector({}, admin, deps([missing], async () => {
      throw new MarketplaceItemNotFoundError("nope");
    }));
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    const { data: l } = await admin.from("listings").select("status, last_attempt_at").eq("id", missing.id).single();
    expect(l!.status).toBe("active");
    expect(l!.last_attempt_at).not.toBeNull();
    expect(new Date(l!.last_attempt_at!).getTime()).toBeGreaterThanOrEqual(before - 5_000);
  });
});
