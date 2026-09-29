import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { refreshEffectivePrices } from "@/lib/vouchers/refresh-effective";
import { effectivePriceFor, effectiveQuoteFor } from "@/lib/vouchers/effective";
import { listVouchersForListing } from "@/lib/vouchers/store";
import { admin } from "./helpers";

// refreshEffectivePrices (spec 2026-09-28 §4): fills offers.effective_price from the offer's latest
// valid price and the listing's active vouchers; clears it when no voucher applies any more.
// The local DB may hold marketplace-wide seed vouchers, so expectations go through `expected()`
// (same pure math over the vouchers in the DB); the listing's own voucher must always count.
const ext = `test_${randomUUID()}`;
const slugBase = `test-effective-${ext.slice(5, 11)}`;
let listingId = "";
let sellerId = "";
let offerId = "";

const offer = async () => {
  const { data, error } = await admin
    .from("offers")
    .select("effective_price, effective_price_at, effective_price_until")
    .eq("id", offerId)
    .single();
  if (error) throw error;
  return {
    price: data.effective_price != null ? Number(data.effective_price) : null,
    at: data.effective_price_at,
    until: data.effective_price_until,
  };
};

const expected = async (price: number, now = new Date()) => {
  const scope = { marketplace: "shopee", listingId, sellerId };
  return effectivePriceFor(price, await listVouchersForListing(admin, { ...scope, now }), { ...scope, now });
};

const expectedQuote = async (price: number, now = new Date()) => {
  const scope = { marketplace: "shopee", listingId, sellerId };
  return effectiveQuoteFor(price, await listVouchersForListing(admin, { ...scope, now }), { ...scope, now });
};

const addVoucher = async (over: { expiresAt?: string } = {}) => {
  const { error } = await admin.rpc("upsert_vouchers", {
    p_items: [
      {
        marketplace: "shopee",
        kind: "shop",
        sellerId,
        listingId,
        code: "",
        discountType: "amount",
        discountValue: 10_000,
        minSpend: 0,
        ...over,
      },
    ],
    p_source: "api",
  });
  if (error) throw error;
};

const removeVoucher = () => admin.from("vouchers").delete().eq("seller_id", sellerId);

beforeAll(async () => {
  const { error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: ext,
      url: "https://shopee.vn/product/1/2",
      title: `effective test ${ext}`,
      slug_base: slugBase,
      source: "seed",
      seller: { external_id: `seller-${ext}`, name: "Shop test", rating: 4.7 },
      models: [{ model_id: "m", name: "x", price: 100_000, stock: 3 }],
    },
  });
  if (error) throw error;
  const { data: l } = await admin.from("listings").select("id, seller_id").eq("external_item_id", ext).single();
  listingId = l!.id;
  sellerId = l!.seller_id!;
  const { data: o } = await admin.from("offers").select("id").eq("listing_id", listingId).single();
  offerId = o!.id;
});

afterAll(async () => {
  await removeVoucher();
  await admin.from("listings").delete().eq("external_item_id", ext);
  await admin.from("products").delete().like("slug", `${slugBase}%`);
  await admin.from("sellers").delete().eq("id", sellerId);
});

describe("refreshEffectivePrices", () => {
  it("without the listing's voucher → whatever marketplace-wide vouchers give (usually null)", async () => {
    await refreshEffectivePrices(admin, { listingIds: [listingId] });
    expect((await offer()).price).toBe(await expected(100_000));
  });

  it("writes price minus the best voucher combination, with a timestamp", async () => {
    await addVoucher();
    const now = new Date();
    const res = await refreshEffectivePrices(admin, { listingIds: [listingId], now });
    expect(res.updated).toBeGreaterThanOrEqual(1);
    const o = await offer();
    expect(o.price).toBe(await expected(100_000, now));
    expect(o.price).toBeLessThanOrEqual(90_000);
    expect(Date.parse(o.at!)).toBe(now.getTime());
  });

  it("uses the latest VALID observation as the current price", async () => {
    const t = Date.now();
    const { error } = await admin.from("price_observations").insert([
      { offer_id: offerId, price: 200_000, observed_at: new Date(t + 1_000).toISOString(), source: "seed", is_valid: true, invalid_reason: null },
      { offer_id: offerId, price: 50_000, observed_at: new Date(t + 2_000).toISOString(), source: "seed", is_valid: false, invalid_reason: "test" },
    ]);
    expect(error).toBeNull();
    await refreshEffectivePrices(admin, { listingIds: [listingId], now: new Date(t + 3_000) });
    const value = await offer();
    expect(value.price).toBe(await expected(200_000));
    expect(value.price).toBeLessThanOrEqual(190_000);
    expect(value.price).toBeGreaterThan(50_000);
  });

  it("the full run (no listingIds) finds listings with fresh vouchers", async () => {
    await admin.from("offers").update({ effective_price: null, effective_price_at: null }).eq("id", offerId);
    await refreshEffectivePrices(admin);
    expect((await offer()).price).toBe(await expected(200_000));
  });

  it("removing the voucher then refreshing drops its discount (both modes)", async () => {
    await removeVoucher();
    await refreshEffectivePrices(admin);
    expect((await offer()).price).toBe(await expected(200_000));

    await addVoucher();
    await refreshEffectivePrices(admin, { listingIds: [listingId] });
    expect((await offer()).price).toBeLessThanOrEqual(190_000);
    await removeVoucher();
    await refreshEffectivePrices(admin, { listingIds: [listingId] });
    const after = await expected(200_000);
    expect((await offer()).price).toBe(after);
    if (after == null) expect((await offer()).at).toBeNull();
  });

  it("writes effective_price_until = earliest expiry of the picked vouchers", async () => {
    const expiresAt = new Date(Date.now() + 3 * 86_400_000);
    await addVoucher({ expiresAt: expiresAt.toISOString() });
    const now = new Date();
    await refreshEffectivePrices(admin, { listingIds: [listingId], now });
    const o = await offer();
    const want = await expectedQuote(200_000, now);
    expect(want).not.toBeNull();
    expect(o.price).toBe(want!.price);
    // The listing's shop voucher is always picked (one per kind), so until is at most its expiry.
    expect(o.until).not.toBeNull();
    expect(Date.parse(o.until!)).toBe(Date.parse(want!.until!));
    expect(Date.parse(o.until!)).toBeLessThanOrEqual(expiresAt.getTime());

    await removeVoucher();
    await refreshEffectivePrices(admin, { listingIds: [listingId] });
    const after = await expectedQuote(200_000);
    const cleared = await offer();
    expect(cleared.price).toBe(after?.price ?? null);
    expect(cleared.until == null ? null : Date.parse(cleared.until)).toBe(after?.until == null ? null : Date.parse(after.until));
  });
});
