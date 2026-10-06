import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toVnDate } from "@/lib/format";
import { recomputeDealScores } from "@/lib/pricing/recompute-scores";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// DB review fixes, catalog side: one offer-visibility rule for rollup / current price / search, scoped and
// sargable rollup, watch re-point state, admin deactivation that sticks, search clamps and score gate.
const tag = `ov${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const extIds: string[] = [];
const createdProductIds: string[] = [];
let categoryId: string;
let user: TestUser;

async function verifiedVariant(name: string) {
  const { data: p, error } = await admin.from("products")
    .insert({ canonical_name: `${name} ${tag}`, brand: "Sony", status: "verified", slug: `test-${tag}-v${createdProductIds.length}`, category_id: categoryId })
    .select("id").single();
  if (error) throw error;
  createdProductIds.push(p.id);
  const { data: v } = await admin.from("product_variants").insert({ product_id: p.id, variant_key: "Đen" }).select("id").single();
  return { productId: p.id, variantId: v!.id };
}

async function ingest(ext: string, price: number, opts: { match?: string; key?: string | null; title?: string; stock?: number } = {}) {
  extIds.push(ext);
  const { data, error } = await admin.rpc("ingest_listing", {
    p: {
      marketplace: "shopee", ext_item_id: ext, url: `https://shopee.vn/product/1/${ext}`,
      title: opts.title ?? `Tai nghe ${tag}`, slug_base: `test-${tag}`, source: "seed",
      seller: { external_id: `seller-${tag}-${ext}`, name: "S" },
      models: [{
        model_id: "default", name: "", price, ...(opts.stock !== undefined ? { stock: opts.stock } : {}),
        ...(opts.match ? { match: { variant_id: opts.match, confidence: 0.99, reason: "t" } } : {}),
      }],
      draft_key: opts.key ?? null,
    },
  });
  if (error) throw error;
  return data as { variant_id: string };
}

async function offerOf(ext: string) {
  const { data } = await admin.from("offers").select("id, listing_id, variant_id, listings!inner(external_item_id)")
    .eq("listings.external_item_id", ext).single();
  return data!;
}

async function rollup(variantId: string) {
  const { data } = await admin.from("variant_daily_prices").select("day, min_price, offer_count").eq("variant_id", variantId).order("day");
  return (data ?? []).map((r) => ({ ...r, min_price: r.min_price == null ? null : Number(r.min_price) }));
}

async function currentPrice(variantId: string) {
  const { data } = await admin.from("variant_current_price").select("price").eq("variant_id", variantId).maybeSingle();
  return data ? Number(data.price) : null;
}

const today = () => toVnDate(new Date());

beforeAll(async () => {
  user = await createTestUser();
  const { data: c } = await admin.from("categories").select("id").limit(1).single();
  categoryId = c!.id;
});

afterAll(async () => {
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-${tag}%`);
  if (createdProductIds.length) await admin.from("products").delete().in("id", createdProductIds);
  await admin.from("sellers").delete().like("external_seller_id", `seller-${tag}%`);
  await admin.from("admin_audit").delete().like("note", `${tag}%`);
  await deleteTestUser(user.id);
});

describe("offer visibility rule", () => {
  it("rollup and current price drop rejected, pending-on-verified and deactivated offers", async () => {
    const { variantId } = await verifiedVariant("Vis");
    await ingest(`a${tag}`, 1_000_000, { match: variantId });
    await ingest(`b${tag}`, 500_000, { match: variantId });
    expect(await currentPrice(variantId)).toBe(500_000);
    expect((await rollup(variantId)).at(-1)).toMatchObject({ day: today(), min_price: 500_000, offer_count: 2 });

    const b = await offerOf(`b${tag}`);
    await admin.from("offers").update({ match_status: "rejected" }).eq("id", b.id);
    await admin.rpc("refresh_variant_daily_prices", { p_from: today(), p_to: today(), p_variant_ids: [variantId] });
    await admin.rpc("refresh_variant_current_price", { p_variant_ids: [variantId] });
    expect((await rollup(variantId)).at(-1)).toMatchObject({ min_price: 1_000_000, offer_count: 1 });
    expect(await currentPrice(variantId)).toBe(1_000_000);

    // 'pending' only counts on a draft.
    const a = await offerOf(`a${tag}`);
    await admin.from("offers").update({ match_status: "pending" }).eq("id", a.id);
    await admin.rpc("refresh_variant_daily_prices", { p_from: today(), p_to: today(), p_variant_ids: [variantId] });
    await admin.rpc("refresh_variant_current_price", { p_variant_ids: [variantId] });
    expect(await rollup(variantId)).toEqual([]);
    expect(await currentPrice(variantId)).toBeNull();

    // An admin deactivation rebuilds the history without the listing.
    await admin.from("offers").update({ match_status: "manual" }).eq("id", a.id);
    await admin.rpc("admin_rebuild_variant_rollup", { p_variant_ids: [variantId] });
    expect(await rollup(variantId)).toHaveLength(1);
    const { data: n } = await admin.rpc("admin_set_listings_inactive", { p_listing_ids: [a.listing_id], p_note: `${tag} vis` });
    expect(n).toBe(1);
    expect(await rollup(variantId)).toEqual([]);
    expect(await currentPrice(variantId)).toBeNull();
  });

  it("pending offers of a draft stay visible", async () => {
    const d = await ingest(`d${tag}`, 700_000);
    expect(await currentPrice(d.variant_id)).toBe(700_000);
    expect(await rollup(d.variant_id)).toMatchObject([{ day: today(), min_price: 700_000 }]);
  });
});

describe("refresh_variant_daily_prices", () => {
  it("groups by Vietnam day at the midnight boundary and only touches the scoped variants", async () => {
    const one = await verifiedVariant("Tz1");
    const two = await verifiedVariant("Tz2");
    await ingest(`t1${tag}`, 900_000, { match: one.variantId });
    await ingest(`t2${tag}`, 900_000, { match: two.variantId });
    const o1 = await offerOf(`t1${tag}`);
    const o2 = await offerOf(`t2${tag}`);
    const yesterday = toVnDate(new Date(Date.now() - 86_400_000));
    // 23:59 VN yesterday (= 16:59 UTC) and 00:01 VN today (= 17:01 UTC the day before).
    await admin.from("price_observations").insert([
      { offer_id: o1.id, observed_at: `${yesterday}T23:59:00+07:00`, price: 800_000, is_valid: true, source: "seed" },
      { offer_id: o1.id, observed_at: `${today()}T00:01:00+07:00`, price: 850_000, is_valid: true, source: "seed" },
      { offer_id: o2.id, observed_at: `${yesterday}T12:00:00+07:00`, price: 100_000, is_valid: true, source: "seed" },
    ]);
    const { error } = await admin.rpc("refresh_variant_daily_prices", { p_from: yesterday, p_to: today(), p_variant_ids: [one.variantId] });
    expect(error).toBeNull();
    expect(await rollup(one.variantId)).toEqual([
      { day: yesterday, min_price: 800_000, offer_count: 1 },
      { day: today(), min_price: 850_000, offer_count: 1 },
    ]);
    // Not in scope: variant two has no row for yesterday yet.
    expect((await rollup(two.variantId)).map((r) => r.day)).toEqual([today()]);
  });

  it("parallel refreshes over overlapping variants finish without lock errors", async () => {
    const { data } = await admin.from("variant_current_price").select("variant_id").limit(40);
    const ids = (data ?? []).map((r) => r.variant_id);
    const calls = Array.from({ length: 8 }, (_, i) =>
      admin.rpc("refresh_variant_daily_prices", {
        p_from: today(), p_to: today(),
        ...(i % 2 ? { p_variant_ids: i % 4 === 1 ? ids : [...ids].reverse() } : {}),
      }),
    );
    const results = await Promise.all(calls);
    expect(results.map((r) => r.error)).toEqual(Array(8).fill(null));
  });

  it("the unscoped call still works for every variant", async () => {
    const { error } = await admin.rpc("refresh_variant_daily_prices", { p_from: today(), p_to: today() });
    expect(error).toBeNull();
  });
});

describe("admin_repoint_watches", () => {
  it("a re-pointed watch gets fresh engine state and a new config_version", async () => {
    const target = await verifiedVariant("Rp");
    await ingest(`rt${tag}`, 600_000, { match: target.variantId });
    const d = await ingest(`rd${tag}`, 900_000);
    const { data: w, error: wErr } = await admin.from("watches")
      .insert({ user_id: user.id, variant_id: d.variant_id, target_price: 950_000, drop_pct: 10, notify_back_in_stock: true })
      .select("id, config_version").single();
    expect(wErr).toBeNull();
    // Engine state as the evaluator would have left it on the draft.
    await admin.from("watches").update({
      cond_state: { target_price: true, drop_pct: true, back_in_stock: false },
      last_alert_price: 900_000, last_in_stock: false, last_alerted_at: new Date().toISOString(),
    }).eq("id", w!.id);

    const offer = await offerOf(`rd${tag}`);
    const { error } = await admin.rpc("admin_move_offer", { p_offer_id: offer.id, p_target_variant_id: target.variantId });
    expect(error).toBeNull();
    const { data: after } = await admin.from("watches")
      .select("variant_id, baseline_price, cond_state, last_alert_price, last_in_stock, last_alerted_at, config_version")
      .eq("id", w!.id).single();
    expect(after).toMatchObject({
      variant_id: target.variantId,
      cond_state: { target_price: true },
      last_alert_price: null,
      last_in_stock: null,
      config_version: w!.config_version + 1,
    });
    expect(Number(after!.baseline_price)).toBe(600_000);
    // The cooldown clock is kept, like a config edit.
    expect(after!.last_alerted_at).not.toBeNull();
    await admin.from("watches").delete().eq("id", w!.id);
  });

  it("an active draft watch wins over the same user's paused one", async () => {
    const target = await verifiedVariant("Rp2");
    const d = await ingest(`ra${tag}`, 900_000);
    const { data: v2 } = await admin.from("product_variants")
      .insert({ product_id: (await admin.from("product_variants").select("product_id").eq("id", d.variant_id).single()).data!.product_id, variant_key: "Trắng" })
      .select("id").single();
    const { data: paused } = await admin.from("watches")
      .insert({ user_id: user.id, variant_id: d.variant_id, target_price: 1, status: "paused" }).select("id").single();
    const { data: active } = await admin.from("watches")
      .insert({ user_id: user.id, variant_id: v2!.id, target_price: 2 }).select("id").single();
    const offer = await offerOf(`ra${tag}`);
    // The draft is emptied: the user's two draft watches collapse into one on the target.
    const { data: moved, error } = await admin.rpc("admin_move_offer", { p_offer_id: offer.id, p_target_variant_id: target.variantId });
    expect(error).toBeNull();
    expect(moved).toMatchObject({ deleted_product_id: expect.any(String) });
    const { data: left } = await admin.from("watches").select("id, variant_id").in("id", [paused!.id, active!.id]);
    expect(left).toEqual([{ id: active!.id, variant_id: target.variantId }]);
    await admin.from("watches").delete().eq("id", active!.id);
  });
});

describe("listings deactivated by the admin", () => {
  it("a collector observation does not reactivate them; a collector 'gone' still can be undone", async () => {
    await ingest(`ad${tag}`, 500_000);
    const o = await offerOf(`ad${tag}`);
    await admin.rpc("admin_set_listings_inactive", { p_listing_ids: [o.listing_id], p_note: `${tag} stick` });
    const observe = () => admin.rpc("record_observations", {
      p: { listing_id: o.listing_id, source: "seed", models: [{ model_id: "default", price: 510_000 }] },
    });
    expect((await observe()).error).toBeNull();
    const status = async () => (await admin.from("listings").select("status, deactivated_by").eq("id", o.listing_id).single()).data;
    expect(await status()).toEqual({ status: "inactive", deactivated_by: "admin" });

    await ingest(`gn${tag}`, 500_000);
    const g = await offerOf(`gn${tag}`);
    await admin.rpc("record_observations", { p: { listing_id: g.listing_id, source: "seed", status: "gone" } });
    expect((await admin.from("listings").select("status, deactivated_by").eq("id", g.listing_id).single()).data)
      .toEqual({ status: "inactive", deactivated_by: "collector" });
    await admin.rpc("record_observations", {
      p: { listing_id: g.listing_id, source: "seed", models: [{ model_id: "default", price: 505_000 }] },
    });
    expect((await admin.from("listings").select("status, deactivated_by").eq("id", g.listing_id).single()).data)
      .toEqual({ status: "active", deactivated_by: null });
  });
});

describe("admin_move_offer slug", () => {
  it("a title with no letters or digits falls back to san-pham", async () => {
    await ingest(`sl${tag}`, 500_000, { title: "!!! ???" });
    const o = await offerOf(`sl${tag}`);
    const { data, error } = await admin.rpc("admin_move_offer", { p_offer_id: o.id });
    expect(error).toBeNull();
    const id = (data as { to_product_id: string }).to_product_id;
    createdProductIds.push(id);
    const { data: p } = await admin.from("products").select("slug").eq("id", id).single();
    expect(p!.slug).toMatch(/^san-pham(-\d+)?$/);
  });
});

describe("search_products", () => {
  it("shows a cached score only while it was computed for the card price; clamps limit", async () => {
    const { productId, variantId } = await verifiedVariant(`Gate`);
    await ingest(`sg${tag}`, 400_000, { match: variantId });
    await admin.from("variant_deal_scores").upsert({ variant_id: variantId, score: 80, recommendation: "buy", price_at_compute: 400_000 });
    const search = async (extra: Record<string, unknown> = {}) => {
      const { data, error } = await admin.rpc("search_products", { p_q: `gate ${tag}`, ...extra });
      expect(error).toBeNull();
      return (data ?? []).filter((r) => r.product_id === productId);
    };
    expect((await search())[0]).toMatchObject({ score: 80, recommendation: "buy" });
    await admin.from("variant_deal_scores").update({ price_at_compute: 450_000 }).eq("variant_id", variantId);
    expect((await search())[0]).toMatchObject({ score: null, recommendation: null });

    const { data: one, error } = await admin.rpc("search_products", { p_q: `gate ${tag}`, p_limit: 0, p_offset: -5 });
    expect(error).toBeNull();
    expect(one).toHaveLength(1);
    const { error: big } = await admin.rpc("search_products", { p_limit: 100_000, p_offset: 100_000_000, p_brands: Array(500).fill("x") });
    expect(big).toBeNull();
  });

  it("a draft sold by two shops survives the marketplace filter", async () => {
    const key = `sony|${tag}|mkt`;
    const a = await ingest(`mk1${tag}`, 300_000, { key, title: `Loa mkt ${tag}` });
    await ingest(`mk2${tag}`, 310_000, { key, title: `Loa mkt ${tag}` });
    const productId = (await admin.from("product_variants").select("product_id").eq("id", a.variant_id).single()).data!.product_id;
    const { data, error } = await admin.rpc("search_products", { p_q: `loa mkt ${tag}`, p_marketplaces: ["shopee"] });
    expect(error).toBeNull();
    expect((data ?? []).map((r) => r.product_id)).toContain(productId);
    const { data: avail } = await admin.rpc("filter_availability");
    expect(avail![0].marketplaces).toContain("shopee");
  });
});

describe("recomputeDealScores", () => {
  it("keeps no cached verdict for a variant that is out of stock everywhere", async () => {
    const { variantId } = await verifiedVariant("Oos");
    await ingest(`os${tag}`, 400_000, { match: variantId, stock: 0 });
    await admin.from("variant_deal_scores").upsert({ variant_id: variantId, score: 90, recommendation: "buy", price_at_compute: 400_000 });
    const { scored } = await recomputeDealScores(admin, { variantIds: [variantId] });
    expect(scored).toBe(0);
    const { data } = await admin.from("variant_deal_scores").select("variant_id").eq("variant_id", variantId);
    expect(data).toEqual([]);
  });
});

describe("trending_products", () => {
  it("ignores a product_id that only looks like a UUID", async () => {
    const bogus = "-".repeat(36);
    await admin.from("analytics_events").insert(
      [1, 2, 3].map((d) => ({ name: "product_viewed" as const, props: { product_id: bogus }, created_at: new Date(Date.now() - d * 3_600_000).toISOString() })),
    );
    const { error } = await admin.rpc("trending_products", { p_mode: "rising" });
    await admin.from("analytics_events").delete().eq("props->>product_id", bogus);
    expect(error).toBeNull();
  });
});
