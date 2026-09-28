import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin } from "./helpers";

// search_products(p_marketplaces) — spec 2026-09-26 §4. Fixtures go through ingest_shopee_item (Shopee
// listings, offers "pending"), then each listing is relabelled (marketplace / status) and its offers marked
// matched or not: the filter only counts matched offers on active listings.
const tag = `zm${randomUUID().slice(0, 6)}`;
const extIds: string[] = [];

async function item(name: string, marketplace: string, status = "active", matchStatus = "manual") {
  const ext = `test_${randomUUID()}`;
  extIds.push(ext);
  const { error } = await admin.rpc("ingest_shopee_item", {
    p: {
      ext_item_id: ext,
      url: "https://shopee.vn/product/1/2",
      title: `${tag} ${name}`,
      slug_base: `test-markets-${tag}`,
      source: "seed",
      seller: { external_id: `seller-${ext}`, name, rating: 4.7 },
      models: [{ model_id: "m", name: "x", price: 100_000, stock: 3 }],
    },
  });
  if (error) throw error;
  const { error: upd } = await admin.from("listings").update({ marketplace, status }).eq("external_item_id", ext);
  if (upd) throw upd;
  const { data: l } = await admin.from("listings").select("id").eq("external_item_id", ext).single();
  const { error: off } = await admin.from("offers").update({ match_status: matchStatus }).eq("listing_id", l!.id);
  if (off) throw off;
}

const search = async (p_marketplaces?: string[]) => {
  const { data, error } = await admin.rpc("search_products", { p_q: tag, p_marketplaces });
  if (error) throw error;
  return (data ?? []).map((r) => r.canonical_name.replace(`${tag} `, "")).sort();
};

beforeAll(async () => {
  await item("shop", "shopee");
  await item("laz", "lazada");
  await item("gone", "lazada", "inactive");
  await item("unmatched", "lazada", "active", "pending");
});

afterAll(async () => {
  const { data: ls } = await admin.from("listings").select("seller_id").in("external_item_id", extIds);
  await admin.from("listings").delete().in("external_item_id", extIds);
  await admin.from("products").delete().like("slug", `test-markets-${tag}%`);
  await admin.from("sellers").delete().in("id", (ls ?? []).map((l) => l.seller_id!).filter(Boolean));
});

describe("search_products marketplace filter", () => {
  it("null or empty array means no filter", async () => {
    expect(await search()).toEqual(["gone", "laz", "shop", "unmatched"]);
    expect(await search([])).toEqual(["gone", "laz", "shop", "unmatched"]);
  });

  it("keeps products with a matched offer on an active listing of the chosen marketplaces", async () => {
    expect(await search(["shopee"])).toEqual(["shop"]);
    expect(await search(["lazada"])).toEqual(["laz"]);
    expect(await search(["shopee", "lazada"])).toEqual(["laz", "shop"]);
    expect(await search(["tiktok"])).toEqual([]);
  });

  it("filter_availability lists marketplaces that have matched offers", async () => {
    const { data, error } = await admin.rpc("filter_availability");
    if (error) throw error;
    expect(data?.[0].marketplaces).toEqual(expect.arrayContaining(["lazada", "shopee"]));
  });
});
