import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordContribution } from "@/lib/extension/contribute";
import type { ObservationPayload } from "@/lib/extension/payload";
import { admin } from "./helpers";

const tag = randomUUID().slice(0, 8);
const item = `9${Date.now() % 1_000_000}_${Math.floor(Math.random() * 1e9)}`;
let offerId: string;

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
});

afterAll(async () => {
  await admin.from("listings").delete().eq("external_item_id", item);
  await admin.from("products").delete().like("slug", `test-ext-${tag}%`);
  await admin.from("sellers").delete().eq("external_seller_id", `seller-${tag}`);
  await admin.from("extension_contributions").delete().like("contributor", `%${tag}%`);
});

const extensionRows = async () =>
  (await admin.from("price_observations").select("price, source").eq("offer_id", offerId).eq("source", "extension")).data ?? [];

describe("recordContribution", () => {
  it("ignores items that are not in the catalog", async () => {
    expect(await recordContribution(admin, `u:a-${tag}`, { ...payload(1), item: "1_1" })).toEqual({ status: "unknown_item" });
  });

  it("one contributor far from the API price is stored but not promoted", async () => {
    const r = await recordContribution(admin, `u:a-${tag}`, payload(1_200_000));
    expect(r).toEqual({ status: "recorded", recorded: 1, promoted: 0 });
    expect(await extensionRows()).toEqual([]);
  });

  it("a second contributor within 2% promotes one observation into the price history", async () => {
    const r = await recordContribution(admin, `ip:b-${tag}`, payload(1_210_000));
    expect(r.status === "recorded" && r.promoted).toBe(1);
    const rows = await extensionRows();
    expect(rows).toHaveLength(1);
    const { data: offer } = await admin.from("offers").select("free_shipping").eq("id", offerId).single();
    expect(offer!.free_shipping).toBe(true);
  });

  it("the same offer is not promoted again within the hour", async () => {
    await recordContribution(admin, `u:c-${tag}`, payload(1_205_000));
    expect(await extensionRows()).toHaveLength(1);
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
