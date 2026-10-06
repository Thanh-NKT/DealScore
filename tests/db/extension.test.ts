import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordContribution } from "@/lib/extension/contribute";
import { effectivePriceFor } from "@/lib/vouchers/effective";
import { listVouchersForListing } from "@/lib/vouchers/store";
import type { ObservationPayload } from "@/lib/extension/payload";
import { admin } from "./helpers";

const tag = randomUUID().slice(0, 8);
const item = `9${Date.now() % 1_000_000}_${Math.floor(Math.random() * 1e9)}`;
let offerId: string;
let listingId: string;
let sellerId: string | null;

const payload = (price: number, extra: Partial<ObservationPayload> = {}): ObservationPayload => ({
  marketplace: "shopee",
  item,
  observedAt: new Date().toISOString(),
  models: [{ modelId: null, name: "Tiêu chuẩn", price, originalPrice: null, stock: 5 }],
  freeShipping: true,
  hasVoucher: null,
  ...extra,
});

beforeAll(async () => {
  const { error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: item,
      url: "https://shopee.vn/product/1/2",
      title: `Ext test ${tag}`,
      slug_base: `test-ext-${tag}`,
      source: "seed",
      seller: { external_id: `seller-${tag}` },
      models: [{ model_id: "m1", name: "Tiêu chuẩn", price: 1_000_000, stock: 5 }],
    },
  });
  if (error) throw error;
  const { data } = await admin.from("offers").select("id, listings!inner(external_item_id)").eq("listings.external_item_id", item).single();
  offerId = data!.id;
  const { data: l } = await admin.from("listings").select("id, seller_id").eq("external_item_id", item).single();
  listingId = l!.id;
  sellerId = l!.seller_id;
  // A listing voucher that only applies above 1.1M: the API price (1M) gets no effective price,
  // the promoted extension price (~1.2M) does.
  const { error: vErr } = await admin.rpc("upsert_vouchers", {
    p_items: [
      { marketplace: "shopee", kind: "shop", sellerId, listingId, code: "", discountType: "amount", discountValue: 100_000, minSpend: 1_100_000 },
    ],
    p_source: "api",
  });
  if (vErr) throw vErr;
});

afterAll(async () => {
  await admin.from("vouchers").delete().eq("listing_id", listingId);
  await admin.from("listings").delete().eq("external_item_id", item);
  await admin.from("products").delete().like("slug", `test-ext-${tag}%`);
  await admin.from("sellers").delete().eq("external_seller_id", `seller-${tag}`);
  await admin.from("extension_contributions").delete().like("contributor", `%${tag}%`);
});

const who = (contributor: string, peerKey: string) => ({ contributor, peerKey });

const variantOf = async () =>
  (await admin.from("offers").select("variant_id").eq("id", offerId).single()).data?.variant_id ?? null;

const extensionRows = async () =>
  (await admin.from("price_observations").select("price, source").eq("offer_id", offerId).eq("source", "extension")).data ?? [];

describe("recordContribution", () => {
  it("ignores items that are not in the catalog", async () => {
    expect(await recordContribution(admin, who(`u:a-${tag}`, `netA-${tag}`), { ...payload(1), item: "1_1" })).toEqual({ status: "unknown_item" });
  });

  it("one contributor far from the API price is stored but not promoted", async () => {
    const r = await recordContribution(admin, who(`u:a-${tag}`, `netA-${tag}`), payload(1_200_000));
    expect(r).toEqual({ status: "recorded", recorded: 1, promoted: 0 });
    expect(await extensionRows()).toEqual([]);
  });

  it("the same person without the account cookie (same network) does not corroborate themselves", async () => {
    const r = await recordContribution(admin, who(`ip:netA-${tag}`, `netA-${tag}`), payload(1_210_000));
    expect(r).toEqual({ status: "recorded", recorded: 1, promoted: 0 });
    expect(await extensionRows()).toEqual([]);
  });

  it("a second independent contributor within 2% promotes one observation into the price history", async () => {
    const r = await recordContribution(admin, who(`ip:netB-${tag}`, `netB-${tag}`), payload(1_210_000));
    expect(r.status === "recorded" && r.promoted).toBe(1);
    const rows = await extensionRows();
    expect(rows).toHaveLength(1);
    const { data: offer } = await admin.from("offers").select("free_shipping").eq("id", offerId).single();
    expect(offer!.free_shipping).toBe(true);
  });

  it("promotion refreshes the listing's effective price from the promoted observation", async () => {
    const { data: o } = await admin
      .from("offers")
      .select("effective_price, effective_price_at")
      .eq("id", offerId)
      .single();
    const { data: latest } = await admin.rpc("latest_price_per_offer", { p_variant_id: (await variantOf())! });
    const cur = (latest ?? []).find((r) => r.offer_id === offerId)!;
    // A promoted extension price (above the voucher's 1.1M min spend), not the 1M API price.
    const price = Number(cur.price);
    expect(price).toBeGreaterThan(1_100_000);

    const now = new Date();
    const scope = { marketplace: "shopee", listingId, sellerId };
    const want = effectivePriceFor(price, await listVouchersForListing(admin, { ...scope, now }), { ...scope, now });
    expect(want).not.toBeNull();
    expect(Number(o!.effective_price)).toBe(want);
    expect(Date.parse(o!.effective_price_at!)).toBeGreaterThanOrEqual(Date.parse(cur.observed_at!));
  });

  it("the same offer is not promoted again within the hour", async () => {
    await recordContribution(admin, who(`u:c-${tag}`, `netC-${tag}`), payload(1_205_000));
    expect(await extensionRows()).toHaveLength(1);
  });
});

describe("recordContribution — forged prices", () => {
  const item2 = `8${Date.now() % 1_000_000}_${Math.floor(Math.random() * 1e9)}`;
  let offer2: string;

  beforeAll(async () => {
    const { error } = await admin.rpc("ingest_shopee_item", {
      p: {
        ext_item_id: item2,
        url: "https://shopee.vn/product/1/3",
        title: `Ext forged ${tag}`,
        slug_base: `test-ext-${tag}-forged`,
        source: "seed",
        seller: { external_id: `seller-${tag}` },
        models: [{ model_id: "m1", name: "Tiêu chuẩn", price: 1_000_000, stock: 5 }],
      },
    });
    if (error) throw error;
    offer2 = (await admin.from("offers").select("id, listings!inner(external_item_id)").eq("listings.external_item_id", item2).single()).data!.id;
  });

  afterAll(async () => {
    await admin.from("listings").delete().eq("external_item_id", item2);
  });

  it("two independent contributors agreeing on a price far below the API price are not promoted", async () => {
    const forged = { ...payload(100_000), item: item2 };
    await recordContribution(admin, who(`u:f1-${tag}`, `netF1-${tag}`), forged);
    const r = await recordContribution(admin, who(`ip:netF2-${tag}`, `netF2-${tag}`), forged);
    expect(r).toEqual({ status: "recorded", recorded: 1, promoted: 0 });
    const { data } = await admin.from("price_observations").select("price").eq("offer_id", offer2).eq("source", "extension");
    expect(data).toEqual([]);
  });

  it("stores the peer key with the contribution", async () => {
    const { data } = await admin.from("extension_observations").select("contributor, peer_key").eq("offer_id", offer2).order("id");
    expect(data).toEqual([
      { contributor: `u:f1-${tag}`, peer_key: `netF1-${tag}` },
      { contributor: `ip:netF2-${tag}`, peer_key: `netF2-${tag}` },
    ]);
  });
});

describe("extension_contribution_begin", () => {
  it("allows up to the limit per contributor per hour, then asks to retry later", async () => {
    const who = `quota-${tag}`;
    const call = async () => (await admin.rpc("extension_contribution_begin", { p_contributor: who, p_limit: 2 })).data?.[0];
    expect((await call())?.allowed).toBe(true);
    expect((await call())?.allowed).toBe(true);
    const third = await call();
    expect(third?.allowed).toBe(false);
    expect(third?.retry_after_seconds).toBeGreaterThan(0);
  });
});
