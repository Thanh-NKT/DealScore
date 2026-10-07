import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addAffiliateDisclosure } from "@/lib/affiliate/disclosure";
import { listMyWatches } from "@/lib/watch/queries";
import { admin, createTestUser, deleteTestUser, type TestUser } from "./helpers";

// MyWatchItem.buy: the "Đến {sàn}" target read through the user's own (RLS) client.
const tag = `buy${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const N = 205; // > one 200-id batch of the offers lookup
let user: TestUser;
let productId: string;
const variants: string[] = [];
const offers: string[] = [];

beforeAll(async () => {
  user = await createTestUser();
  const { data: p, error } = await admin.from("products")
    .insert({ canonical_name: `Buy ${tag}`, status: "verified", slug: `test-${tag}` }).select("id").single();
  if (error) throw error;
  productId = p!.id;
  const { data: vs, error: vErr } = await admin.from("product_variants")
    .insert(Array.from({ length: N }, (_, i) => ({ product_id: productId, variant_key: `V${String(i).padStart(3, "0")}` })))
    .select("id, variant_key");
  if (vErr) throw vErr;
  vs!.sort((a, b) => (a.variant_key < b.variant_key ? -1 : 1)).forEach((v) => variants.push(v.id));
  const { data: ls, error: lErr } = await admin.from("listings")
    .insert(variants.map((_, i) => ({
      marketplace: i % 2 === 0 ? "shopee" : "tiktok", external_item_id: `${tag}-${i}`, title: `L${i}`,
      url: `https://shopee.vn/${tag}-${i}`, last_observed_at: new Date().toISOString(),
    }))).select("id, external_item_id");
  if (lErr) throw lErr;
  const listingOf = new Map(ls!.map((l) => [l.external_item_id, l.id]));
  const { data: os, error: oErr } = await admin.from("offers")
    .insert(variants.map((v, i) => ({ listing_id: listingOf.get(`${tag}-${i}`)!, variant_id: v, match_status: "manual", external_model_id: "default" })))
    .select("id, variant_id");
  if (oErr) throw oErr;
  const offerOf = new Map(os!.map((o) => [o.variant_id, o.id]));
  variants.forEach((v) => offers.push(offerOf.get(v)!));
  // Only offer 0 is affiliate-eligible; offer 1 has an ineligible row.
  const { error: aErr } = await admin.from("affiliate_offers")
    .insert([{ offer_id: offers[0], eligible: true }, { offer_id: offers[1], eligible: false }]);
  if (aErr) throw aErr;
  const now = new Date().toISOString();
  const { error: cErr } = await admin.from("variant_current_price").insert(variants.map((v, i) => ({
    variant_id: v, best_offer_id: offers[i], price: 900_000, in_stock: i !== 2, observed_at: now, offer_count: 1,
  })));
  if (cErr) throw cErr;
  // Watch 0..2 active; the rest paused (the 50-active cap). Watch 3 has a target that is not reached yet.
  const { error: wErr } = await admin.from("watches").insert(variants.map((v, i) => ({
    user_id: user.id, variant_id: v, product_id: productId, target_price: i === 3 ? 500_000 : 1_000_000,
    status: i < 4 ? "active" : "paused",
  })));
  if (wErr) throw wErr;
});

afterAll(async () => {
  await admin.from("listings").delete().like("external_item_id", `${tag}-%`);
  await admin.from("products").delete().eq("id", productId);
  await deleteTestUser(user.id);
});

describe("listMyWatches buy target", () => {
  it("returns the best offer's marketplace and affiliate flag when the target is reached", async () => {
    const raw = await listMyWatches(user.id, new Date(), user.client);
    expect(raw).toHaveLength(N);
    // src/lib/watch never reads affiliate data: the flag is always false until the disclosure step.
    expect(raw.some((i) => i.buy?.affiliate)).toBe(false);
    const items = await addAffiliateDisclosure(user.client, raw);
    const byVariant = new Map(items.map((i) => [i.variant.id, i]));
    expect(byVariant.get(variants[0])!.buy).toEqual({ offerId: offers[0], marketplace: "shopee", affiliate: true });
    expect(byVariant.get(variants[1])!.buy).toEqual({ offerId: offers[1], marketplace: "tiktok", affiliate: false });
    expect(byVariant.get(variants[2])!.buy).toBeNull(); // out of stock
    expect(byVariant.get(variants[3])!.buy).toBeNull(); // target not reached
    // Offers beyond the first 200-id batch are still read.
    expect(byVariant.get(variants[N - 1])!.buy).toEqual({ offerId: offers[N - 1], marketplace: "shopee", affiliate: false });
    expect(items.filter((i) => i.buy !== null)).toHaveLength(N - 2);
  });
});
