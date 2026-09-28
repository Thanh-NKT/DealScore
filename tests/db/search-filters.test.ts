import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

const tag = `zq${randomUUID().slice(0, 6)}`;
const extIds: string[] = [];

async function item(name: string, rating: number, extra: { free_shipping?: boolean; has_voucher?: boolean }) {
  const ext = `test_${randomUUID()}`;
  extIds.push(ext);
  const { error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: ext,
      url: "https://shopee.vn/product/1/2",
      title: `${tag} ${name}`,
      slug_base: `test-filters-${tag}`,
      source: "seed",
      seller: { external_id: `seller-${ext}`, name, rating },
      models: [{ model_id: "m", name: "x", price: 100_000, stock: 3 }],
    },
  });
  if (error) throw error;
  const { data: l } = await admin.from("listings").select("id").eq("external_item_id", ext).single();
  await admin.from("offers").update(extra).eq("listing_id", l!.id);
}

const search = async (args: Record<string, unknown>) => {
  const { data, error } = await admin.rpc("search_products", { p_q: tag, ...args });
  if (error) throw error;
  return (data ?? []).map((r) => r.canonical_name.replace(`${tag} `, "")).sort();
};

beforeAll(async () => {
  await item("good", 4.9, { free_shipping: true, has_voucher: false });
  await item("ok", 4.6, { free_shipping: false });
  await item("low", 4.1, { has_voucher: true });
});

afterAll(async () => {
  const { data: ls } = await admin.from("listings").select("seller_id").in("external_item_id", extIds);
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-filters-${tag}%`);
  await admin.from("sellers").delete().in("id", (ls ?? []).map((l) => l.seller_id!).filter(Boolean));
});

describe("search_products advanced filters", () => {
  it("without filters returns all three", async () => {
    expect(await search({})).toEqual(["good", "low", "ok"]);
  });
  it("filters by the best offer's seller rating", async () => {
    expect(await search({ p_min_rating: 4.5 })).toEqual(["good", "ok"]);
    expect(await search({ p_min_rating: 4.8 })).toEqual(["good"]);
  });
  it("free shipping / voucher keep only offers known to have them (unknown ≠ yes)", async () => {
    expect(await search({ p_free_shipping: true })).toEqual(["good"]);
    expect(await search({ p_has_voucher: true })).toEqual(["low"]);
  });
  it("filter_availability reports data behind each filter", async () => {
    const { data } = await admin.rpc("filter_availability");
    expect(data?.[0]).toMatchObject({ rating: true, free_shipping: true, voucher: true });
  });
});
