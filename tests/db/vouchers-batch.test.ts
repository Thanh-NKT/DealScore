import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listVouchersForListing, listVouchersForListings, upsertVouchers, type VoucherScope } from "@/lib/vouchers/store";
import { admin } from "./helpers";

// The product page reads the vouchers of all its listings in one query (review-pricing-ui I7). The
// batch must return, per listing, exactly what the single-listing read returns.
const tag = randomUUID().replace(/-/g, "").slice(0, 10);
const CODE = `VB${tag.toUpperCase()}`;
const sellerIds: string[] = [];
const listingIds: string[] = [];
const scopes: VoucherScope[] = [];

async function listing(marketplace: string, i: number, withSeller: boolean): Promise<VoucherScope> {
  let sellerId: string | null = null;
  if (withSeller) {
    const { data, error } = await admin.from("sellers").insert({ marketplace, external_seller_id: `vb-${tag}-${i}` }).select("id").single();
    if (error) throw error;
    sellerId = data.id;
    sellerIds.push(sellerId);
  }
  const { data, error } = await admin
    .from("listings")
    .insert({ marketplace, external_item_id: `vb-${tag}-${i}`, seller_id: sellerId, url: `https://x.test/${tag}/${i}`, title: "t", status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  listingIds.push(data.id);
  return { marketplace, listingId: data.id, sellerId };
}

beforeAll(async () => {
  scopes.push(await listing("shopee", 1, true), await listing("shopee", 2, true), await listing("tiktok", 3, false));
  const [a, b, c] = scopes;
  const base = { code: CODE, discountType: "amount" as const, discountValue: 10_000, maxDiscount: null, minSpend: 0, startsAt: null, expiresAt: null };
  await upsertVouchers(
    admin,
    [
      { ...base, marketplace: "shopee", kind: "shop", sellerId: a.sellerId, listingId: a.listingId },
      { ...base, marketplace: "shopee", kind: "shop", sellerId: a.sellerId, listingId: null },
      { ...base, marketplace: "shopee", kind: "shop", sellerId: b.sellerId, listingId: b.listingId },
      { ...base, marketplace: "tiktok", kind: "platform", sellerId: null, listingId: c.listingId },
    ],
    { source: "api" },
  );
});

afterAll(async () => {
  await admin.from("vouchers").delete().like("code", `${CODE}%`);
  await admin.from("listings").delete().in("id", listingIds);
  await admin.from("sellers").delete().in("id", sellerIds);
});

describe("listVouchersForListings", () => {
  it("returns per listing the same vouchers as one listVouchersForListing call each", async () => {
    const now = new Date();
    const batch = await listVouchersForListings(admin, scopes, now);
    for (const s of scopes) {
      const single = await listVouchersForListing(admin, { ...s, now });
      expect(batch[s.listingId].map((v) => v.id).sort(), s.listingId).toEqual(single.map((v) => v.id).sort());
    }
    // Sanity: the fixtures are in there and do not leak across sellers or marketplaces.
    const mine = (id: string) => batch[id].filter((v) => v.code === CODE).length;
    expect([mine(scopes[0].listingId), mine(scopes[1].listingId), mine(scopes[2].listingId)]).toEqual([2, 1, 1]);
  });

  it("a listing with many recent vouchers does not push another listing's candidates out of the batch", async () => {
    const busy = await listing("lazada", 4, false);
    const quiet = await listing("lazada", 5, false);
    const base = { discountType: "amount" as const, discountValue: 5_000, maxDiscount: null, minSpend: 0, startsAt: null, expiresAt: null };
    await upsertVouchers(admin, [{ ...base, code: `${CODE}Q`, marketplace: "lazada", kind: "platform", sellerId: null, listingId: quiet.listingId }], { source: "api" });
    await admin.from("vouchers").update({ last_seen_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("code", `${CODE}Q`);
    // 450 newer vouchers on the busy listing: more than the batch limit for two listings (400).
    await upsertVouchers(
      admin,
      Array.from({ length: 450 }, (_, i) => ({ ...base, code: `${CODE}B${i}`, marketplace: "lazada", kind: "platform" as const, sellerId: null, listingId: busy.listingId })),
      { source: "api" },
    );
    const now = new Date();
    const batch = await listVouchersForListings(admin, [busy, quiet], now);
    expect(batch[quiet.listingId].map((v) => v.code)).toContain(`${CODE}Q`);
    for (const s of [busy, quiet]) {
      const single = await listVouchersForListing(admin, { ...s, now });
      expect(batch[s.listingId].map((v) => v.id).sort()).toEqual(single.map((v) => v.id).sort());
    }
  });

  it("ignores malformed ids and returns an empty list for them", async () => {
    const out = await listVouchersForListings(admin, [{ marketplace: "shopee", listingId: "x),or(id.gt.0", sellerId: null }]);
    expect(out).toEqual({ "x),or(id.gt.0": [] });
  });
});
