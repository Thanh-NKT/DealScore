import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runCollector, type CollectorDeps } from "@/lib/collector/run";
import { ShopeeItemGoneError, ShopeeUnavailableError, type ShopeeItemDetail } from "@/lib/shopee/client";
import type { CollectorListing } from "@/lib/collector/schedule";
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
  return { id: data!.id, externalItemId: ext, refreshPriority: 3, lastObservedAt: old, watched: false };
}

function detail(price: number | null): ShopeeItemDetail {
  return {
    shopId: "",
    itemId: "",
    title: "Collector test",
    sellerName: null,
    sellerRating: null,
    sellerRatingCount: null,
    sellerIsOfficial: false,
    models: [
      { modelId: "m1", name: "2TB", price, originalPrice: null, stock: 5, isFlashSale: false },
      { modelId: "m-new", name: "4TB", price: 5_000_000, originalPrice: null, stock: 1, isFlashSale: false },
    ],
    source: "seed",
  };
}

function deps(listings: CollectorListing[], fetchDetail: CollectorDeps["fetchDetail"]): Partial<CollectorDeps> {
  return {
    configured: () => true,
    loadCandidates: async () => listings,
    fetchDetail,
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

  it("marks a gone item inactive; counts other errors; stops when Shopee is down", async () => {
    const gone = await makeListing(2_000_000);
    const broken = await makeListing(2_000_000);
    const down = await makeListing(2_000_000);
    const never = await makeListing(2_000_000);
    const fetchDetail = vi.fn(async (_s: string, itemId: string) => {
      if (gone.externalItemId.endsWith(itemId)) throw new ShopeeItemGoneError("gone");
      if (broken.externalItemId.endsWith(itemId)) throw new Error("parse error");
      if (down.externalItemId.endsWith(itemId)) throw new ShopeeUnavailableError("503");
      return detail(1_000_000);
    });
    const r = await runCollector({}, admin, deps([gone, broken, down, never], fetchDetail));
    if ("skipped" in r) throw new Error("unexpected skip");
    runIds.push(r.runId);
    expect(r).toMatchObject({ ok: 1, failed: 1, aborted: true });
    expect(fetchDetail).toHaveBeenCalledTimes(3);

    const { data: l } = await admin.from("listings").select("status").eq("id", gone.id).single();
    expect(l!.status).toBe("inactive");
    const { data: run } = await admin.from("collector_runs").select("error_summary").eq("id", r.runId).single();
    expect(run!.error_summary).toContain("parse error");
    expect(run!.error_summary).toContain("Shopee unavailable");
  });
});
