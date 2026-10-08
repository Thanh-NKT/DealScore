import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { toVnDate } from "@/lib/format";
import { detectPriceAnomalies } from "@/lib/anomalies/detect";
import { admin, createTestUser, deleteTestUser, SUPABASE_URL, type TestUser } from "./helpers";

// Migration 0051: price_anomalies, detect_price_anomalies and the admin review RPCs (roadmap P3 item 10).
// Listings are on "lazada" so the ordering checks are not mixed with other tests' (shopee) anomalies.
const tag = `pa${randomUUID().replace(/-/g, "").slice(0, 8)}`;
let categoryId: string;
let seq = 0;
const extIds: string[] = [];
const productIds: string[] = [];
let user: TestUser;

const H = 3_600_000;
const D = 24 * H;
const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

type Obs = { msAgo: number; price: number | null; flash?: boolean; source?: string; valid?: boolean; reason?: string };

async function seedOffer(opts: { obs: Obs[]; matchStatus?: string; product?: { id: string; variantId: string } }) {
  let productId = opts.product?.id;
  let variantId = opts.product?.variantId;
  if (!productId) {
    const { data: p, error } = await admin.from("products")
      .insert({ canonical_name: `Anomaly ${tag} ${++seq}`, brand: "Test", status: "verified", slug: `test-${tag}-${seq}`, category_id: categoryId })
      .select("id").single();
    if (error) throw error;
    productId = p.id;
    productIds.push(p.id);
    const { data: v } = await admin.from("product_variants").insert({ product_id: p.id, variant_key: "Mặc định" }).select("id").single();
    variantId = v!.id;
  }
  const ext = `ext-${tag}-${++seq}`;
  extIds.push(ext);
  const { data: l } = await admin.from("listings")
    .insert({ marketplace: "lazada", external_item_id: ext, url: `https://lazada.vn/${ext}`, title: `Listing ${ext}`, status: "active" })
    .select("id").single();
  const { data: o, error: oErr } = await admin.from("offers")
    .insert({ listing_id: l!.id, variant_id: variantId!, match_status: opts.matchStatus ?? "manual" }).select("id").single();
  if (oErr) throw oErr;
  const { data: rows, error: pErr } = await admin.from("price_observations").insert(
    opts.obs.map((x) => ({
      offer_id: o.id, observed_at: at(x.msAgo), price: x.price, is_flash_sale: x.flash ?? false, source: x.source ?? "api",
      is_valid: x.valid ?? (x.price != null && x.price > 0), invalid_reason: x.reason ?? null,
    })),
  ).select("id, observed_at, price");
  if (pErr) throw pErr;
  await admin.rpc("admin_rebuild_variant_rollup", { p_variant_ids: [variantId!] });
  return { productId: productId!, variantId: variantId!, offerId: o.id, listingId: l!.id, obs: rows! };
}

/** n stable observations at `price`, one per day from 1 to n days ago (plus a few hours). */
const stable = (n: number, price = 1_000_000): Obs[] => Array.from({ length: n }, (_, i) => ({ msAgo: (i + 1) * D + 3 * H, price }));

const detect = (offerIds: string[], sinceMsAgo = 2 * H) =>
  admin.rpc("detect_price_anomalies", {
    p_since: at(sinceMsAgo), p_baseline_days: 30, p_spike_ratio: 3, p_drop_ratio: 0.4, p_min_baseline_obs: 5, p_offer_ids: offerIds,
  });

async function anomaliesOf(offerId: string) {
  const { data } = await admin.from("price_anomalies").select("*").eq("offer_id", offerId);
  return data ?? [];
}

let spike: Awaited<ReturnType<typeof seedOffer>>;
let drop: Awaited<ReturnType<typeof seedOffer>>;
let mild: Awaited<ReturnType<typeof seedOffer>>;
let thin: Awaited<ReturnType<typeof seedOffer>>;
let flashExt: Awaited<ReturnType<typeof seedOffer>>;
let rejected: Awaited<ReturnType<typeof seedOffer>>;
let spike4: Awaited<ReturnType<typeof seedOffer>>;

beforeAll(async () => {
  const { data: c } = await admin.from("categories").select("id").limit(1).single();
  categoryId = c!.id;
  user = await createTestUser();
  spike = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 10_000_000 }] });
  drop = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 350_000 }] });
  mild = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 2_500_000 }] });
  thin = await seedOffer({ obs: [...stable(4), { msAgo: H, price: 10_000_000 }] });
  flashExt = await seedOffer({
    obs: [...stable(10), { msAgo: H, price: 10_000_000, flash: true }, { msAgo: H / 2, price: 9_000_000, source: "extension" },
      // Extension prices never count in the baseline either.
      ...Array.from({ length: 10 }, (_, i) => ({ msAgo: (i + 1) * D, price: 100_000, source: "extension" }))],
  });
  rejected = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 10_000_000 }], matchStatus: "rejected" });
  spike4 = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 4_000_000 }] });
  // An active watch on the drop offer's variant: it sorts first in the open queue.
  await admin.from("watches").insert({ user_id: user.id, variant_id: drop.variantId, target_price: 100_000 });
});

afterAll(async () => {
  await deleteTestUser(user.id);
  if (extIds.length) await admin.from("listings").delete().in("external_item_id", extIds);
  if (productIds.length) await admin.from("products").delete().in("id", productIds);
});

describe("detect_price_anomalies", () => {
  it("flags ×10 as a spike and −65% as a drop against the offer's own 30-day median", async () => {
    const { data, error } = await detect([spike.offerId, drop.offerId, mild.offerId, thin.offerId, flashExt.offerId, rejected.offerId, spike4.offerId]);
    expect(error).toBeNull();
    expect(data).toBe(3);
    const [s] = await anomaliesOf(spike.offerId);
    expect(s).toMatchObject({ kind: "spike", status: "open", price: 10_000_000, baseline_price: 1_000_000, ratio: 10, baseline_obs: 10 });
    expect(s.observation_id).toBe(spike.obs.at(-1)!.id);
    const [d] = await anomaliesOf(drop.offerId);
    expect(d).toMatchObject({ kind: "drop", price: 350_000, ratio: 0.35 });
    expect((await anomaliesOf(spike4.offerId))[0]).toMatchObject({ kind: "spike", ratio: 4 });
  });

  it("ignores ×2.5, a thin baseline (< 5 obs), flash / extension observations and rejected offers", async () => {
    for (const o of [mild, thin, flashExt, rejected]) expect(await anomaliesOf(o.offerId)).toEqual([]);
  });

  it("a second scan inserts nothing; a kept anomaly is never re-created", async () => {
    expect((await detect([spike.offerId, drop.offerId, spike4.offerId])).data).toBe(0);
    const [a] = await anomaliesOf(spike4.offerId);
    expect((await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "keep" })).error).toBeNull();
    expect((await detect([spike4.offerId])).data).toBe(0);
    const rows = await anomaliesOf(spike4.offerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("kept");
  });

  it("only looks at observations since p_since", async () => {
    const late = await seedOffer({ obs: [...stable(10), { msAgo: 5 * H, price: 10_000_000 }] });
    expect((await detect([late.offerId], 2 * H)).data).toBe(0);
    expect((await detect([late.offerId], 6 * H)).data).toBe(1);
  });

  it("rejects bad parameters", async () => {
    const base = { p_since: at(H), p_baseline_days: 30, p_spike_ratio: 3, p_drop_ratio: 0.4, p_min_baseline_obs: 5 };
    for (const bad of [
      { p_spike_ratio: 1 }, { p_drop_ratio: 0 }, { p_drop_ratio: 1 }, { p_baseline_days: 0 }, { p_baseline_days: 366 },
      { p_min_baseline_obs: 0 }, { p_since: at(32 * D) },
    ]) {
      const { error } = await admin.rpc("detect_price_anomalies", { ...base, ...bad });
      expect(error?.message).toContain("detect_price_anomalies: tham số không hợp lệ");
    }
  });

  it("detectPriceAnomalies() passes the DealScore thresholds", async () => {
    const t = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 3_000_000 }] });
    expect(await detectPriceAnomalies(admin, { since: new Date(Date.now() - 2 * H), offerIds: [t.offerId] })).toBe(1);
    expect((await anomaliesOf(t.offerId))[0].kind).toBe("spike");
  });
});

describe("admin_review_price_anomalies", () => {
  it("invalidate: is_valid false + admin_anomaly, no row deleted, current price and daily rollup recomputed; one audit row", async () => {
    const [a] = await anomaliesOf(spike.offerId);
    const { data: cur0 } = await admin.from("variant_current_price").select("price").eq("variant_id", spike.variantId).single();
    expect(cur0!.price).toBe(10_000_000);
    const obsCount = async () =>
      (await admin.from("price_observations").select("id", { count: "exact", head: true }).eq("offer_id", spike.offerId)).count;
    const before = await obsCount();

    const { data, error } = await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "invalidate", p_note: "  lỗi số 0  " });
    expect(error).toBeNull();
    expect(data).toEqual({ updated: 1, skipped: 0, variant_ids: [spike.variantId] });
    expect(await obsCount()).toBe(before);
    const { data: ob } = await admin.from("price_observations").select("is_valid, invalid_reason").eq("id", a.observation_id).single();
    expect(ob).toEqual({ is_valid: false, invalid_reason: "admin_anomaly" });
    const { data: cur } = await admin.from("variant_current_price").select("price").eq("variant_id", spike.variantId).single();
    expect(cur!.price).toBe(1_000_000);
    const { data: day } = await admin.from("variant_daily_prices").select("max_price")
      .eq("variant_id", spike.variantId).eq("day", toVnDate(new Date(a.observed_at)));
    expect((day ?? []).every((r) => r.max_price !== 10_000_000)).toBe(true);
    const { data: row } = await admin.from("price_anomalies").select("status, reviewed_at, review_note").eq("id", a.id).single();
    expect(row!.status).toBe("invalidated");
    expect(row!.reviewed_at).not.toBeNull();
    expect(row!.review_note).toBe("lỗi số 0");
    const { data: audit } = await admin.from("admin_audit").select("action, entity, before, after, note").eq("entity", "price_anomaly").eq("entity_id", a.id);
    expect(audit).toHaveLength(1);
    expect(audit![0]).toMatchObject({
      action: "price_anomaly.invalidate", note: "lỗi số 0",
      before: { status: "open", observation_valid: true, offer_id: spike.offerId, product_id: spike.productId, kind: "spike" },
      after: { status: "invalidated", observation_valid: false },
    });
  });

  it("repeating the same decision is skipped with no audit row", async () => {
    const [a] = await anomaliesOf(spike.offerId);
    const { data } = await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id, randomUUID()], p_decision: "invalidate" });
    expect(data).toEqual({ updated: 0, skipped: 2, variant_ids: [] });
    const { count } = await admin.from("admin_audit").select("id", { count: "exact", head: true }).eq("entity", "price_anomaly").eq("entity_id", a.id);
    expect(count).toBe(1);
  });

  it("reopen restores the observation and clears reviewed_at; keep after invalidate restores it too", async () => {
    const [a] = await anomaliesOf(spike.offerId);
    expect((await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "reopen" })).data).toMatchObject({ updated: 1 });
    const { data: ob } = await admin.from("price_observations").select("is_valid, invalid_reason").eq("id", a.observation_id).single();
    expect(ob).toEqual({ is_valid: true, invalid_reason: null });
    const { data: row } = await admin.from("price_anomalies").select("status, reviewed_at").eq("id", a.id).single();
    expect(row).toEqual({ status: "open", reviewed_at: null });
    expect((await admin.from("variant_current_price").select("price").eq("variant_id", spike.variantId).single()).data!.price).toBe(10_000_000);

    await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "invalidate" });
    expect((await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "keep" })).data).toMatchObject({ updated: 1 });
    const { data: ob2 } = await admin.from("price_observations").select("is_valid").eq("id", a.observation_id).single();
    expect(ob2!.is_valid).toBe(true);
  });

  it("never makes a no_price observation valid", async () => {
    const t = await seedOffer({ obs: [...stable(3), { msAgo: H, price: null, valid: false, reason: "no_price" }] });
    const ob = t.obs.at(-1)!;
    const { data: an } = await admin.from("price_anomalies").insert({
      observation_id: ob.id, observed_at: ob.observed_at, offer_id: t.offerId, kind: "drop", price: 1, baseline_price: 1_000_000,
      ratio: 0.000001, baseline_obs: 3, status: "invalidated",
    }).select("id").single();
    const { data } = await admin.rpc("admin_review_price_anomalies", { p_ids: [an!.id], p_decision: "keep" });
    expect(data).toEqual({ updated: 1, skipped: 0, variant_ids: [] });
    const { data: after } = await admin.from("price_observations").select("is_valid, invalid_reason").eq("id", ob.id).single();
    expect(after).toEqual({ is_valid: false, invalid_reason: "no_price" });
  });

  it("validates the decision, the id count and the note", async () => {
    const ids = Array.from({ length: 101 }, () => randomUUID());
    for (const args of [
      { p_ids: ids, p_decision: "keep" },
      { p_ids: [] as string[], p_decision: "keep" },
      { p_ids: [ids[0]], p_decision: "delete" },
      { p_ids: [ids[0]], p_decision: "keep", p_note: "x".repeat(501) },
    ]) {
      const { error } = await admin.rpc("admin_review_price_anomalies", args);
      expect(error?.message).toContain("admin_review_price_anomalies:");
    }
  });
});

describe("admin_price_anomalies / counts", () => {
  it("open queue: watched first, then the largest deviation; filters and total_count", async () => {
    // Unwatched ×20 and ×4 (spike4 is kept by now, so a fresh ×4): the watched −65% drop still comes first.
    const big = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 20_000_000 }] });
    const four = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 4_000_000 }] });
    expect((await detect([big.offerId, four.offerId])).data).toBe(2);
    const { data, error } = await admin.rpc("admin_price_anomalies", { p_marketplace: "lazada", p_limit: 100 });
    expect(error).toBeNull();
    const rows = (data ?? []).filter((r) => [big.offerId, drop.offerId, four.offerId].includes(r.offer_id));
    expect(rows.map((r) => r.offer_id)).toEqual([drop.offerId, big.offerId, four.offerId]);
    const d = rows[0];
    expect(d).toMatchObject({
      kind: "drop", status: "open", watched: true, marketplace: "lazada", listing_id: drop.listingId, variant_id: drop.variantId,
      product_id: drop.productId, product_status: "verified", observation_valid: true, current_price: 350_000,
    });
    expect(Number(d.total_count)).toBe((data ?? []).length);
    expect(rows[1].watched).toBe(false);

    const spikes = (await admin.rpc("admin_price_anomalies", { p_kind: "spike", p_marketplace: "lazada", p_limit: 100 })).data ?? [];
    expect(spikes.every((r) => r.kind === "spike")).toBe(true);
    const one = (await admin.rpc("admin_price_anomalies", { p_status: "all", p_offer_id: spike4.offerId })).data ?? [];
    expect(one.map((r) => r.status)).toEqual(["kept"]);
    const page = (await admin.rpc("admin_price_anomalies", { p_marketplace: "lazada", p_limit: 1, p_offset: 1 })).data ?? [];
    expect(page).toHaveLength(1);
    expect(Number(page[0].total_count)).toBe((data ?? []).length);
  });

  it("rejects bad filters", async () => {
    for (const args of [{ p_status: "done" }, { p_kind: "flat" }, { p_marketplace: "x".repeat(21) }]) {
      const { error } = await admin.rpc("admin_price_anomalies", args);
      expect(error?.message).toContain("admin_price_anomalies: bộ lọc không hợp lệ");
    }
  });

  it("counts", async () => {
    const { data, error } = await admin.rpc("admin_price_anomaly_counts");
    expect(error).toBeNull();
    const c = data as { open: number; open_by_kind: { spike: number; drop: number }; invalidated_7d: number; kept_7d: number; oldest_open_at: string | null };
    expect(c.open).toBeGreaterThanOrEqual(2);
    expect(c.open_by_kind.drop).toBeGreaterThanOrEqual(1);
    expect(c.kept_7d).toBeGreaterThanOrEqual(1);
    expect(c.oldest_open_at).not.toBeNull();
  });

  it("anon / authenticated can neither read the table nor call the RPCs", async () => {
    const anon = createClient<Database>(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const c of [anon, user.client]) {
      expect((await c.from("price_anomalies").select("id")).error?.code).toBe("42501");
      expect((await c.rpc("admin_price_anomalies", {})).error?.code).toBe("42501");
      expect((await c.rpc("admin_price_anomaly_counts")).error?.code).toBe("42501");
      expect((await c.rpc("admin_review_price_anomalies", { p_ids: [randomUUID()], p_decision: "keep" })).error?.code).toBe("42501");
      expect((await c.rpc("detect_price_anomalies", {
        p_since: at(H), p_baseline_days: 30, p_spike_ratio: 3, p_drop_ratio: 0.4, p_min_baseline_obs: 5,
      })).error?.code).toBe("42501");
    }
  });
});

// Migration 0055 (review P3 I2): the "price after voucher" cache was computed from the bad price, so a
// review that changes an observation clears it; the next collector pass recomputes it from valid prices.
describe("admin_review_price_anomalies clears offers.effective_price*", () => {
  it("invalidating a drop nulls the offer's effective price; other offers keep theirs; a skipped id changes nothing", async () => {
    const t = await seedOffer({ obs: [...stable(10), { msAgo: H, price: 300_000 }] });
    const other = await seedOffer({ obs: stable(3) });
    expect((await detect([t.offerId])).data).toBe(1);
    const [a] = await anomaliesOf(t.offerId);
    const eff = { effective_price: 280_000, effective_price_at: at(H / 2), effective_price_until: at(-D) };
    await admin.from("offers").update(eff).in("id", [t.offerId, other.offerId]);
    const read = async (id: string) =>
      (await admin.from("offers").select("effective_price, effective_price_at, effective_price_until").eq("id", id).single()).data!;

    // Repeating a decision the row already has (open → reopen) is a no-op and keeps the cache.
    await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "reopen" });
    expect((await read(t.offerId)).effective_price).toBe(280_000);

    const { error } = await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "invalidate" });
    expect(error).toBeNull();
    expect(await read(t.offerId)).toEqual({ effective_price: null, effective_price_at: null, effective_price_until: null });
    expect((await read(other.offerId)).effective_price).toBe(280_000);

    // Restoring the price (keep) also clears a cache computed meanwhile without it.
    await admin.from("offers").update(eff).eq("id", t.offerId);
    await admin.rpc("admin_review_price_anomalies", { p_ids: [a.id], p_decision: "keep" });
    expect((await read(t.offerId)).effective_price).toBeNull();
  });
});
