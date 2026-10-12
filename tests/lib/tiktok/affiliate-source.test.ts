import { describe, expect, it, vi } from "vitest";
import {
  fetchTikTokItem,
  fetchTikTokItems,
  searchTikTokItems,
  TIKTOK_PRODUCTS_BY_ID_PATH,
  TIKTOK_SEARCH_PATH,
} from "@/lib/tiktok/affiliate-source";
import { MarketplaceItemNotFoundError } from "@/lib/marketplaces/types";

// Documented shape (Search Open Collaboration Products 202405): `sales_price`, shop has only a name.
const p = (id: string) => ({ id, title: `P${id}`, sales_price: { minimum_amount: "100000", currency: "VND" }, shop: { name: "S" } });

describe("paths (T1/T4)", () => {
  it("use the documented plural open_collaborations", () => {
    expect(TIKTOK_SEARCH_PATH).toBe("/affiliate_creator/202405/open_collaborations/products/search");
    expect(TIKTOK_PRODUCTS_BY_ID_PATH).toBe("/affiliate_creator/202509/open_collaborations/products");
  });
});

describe("searchTikTokItems", () => {
  it("keyword search with page token; next cursor from next_page_token", async () => {
    const call = vi.fn(async () => ({ products: [p("1"), { junk: true }], next_page_token: "tok2" }));
    const page = await searchTikTokItems({ kind: "keyword", value: "tai nghe", cursor: "tok1", limit: 50 }, call as never);
    expect(call).toHaveBeenCalledWith(TIKTOK_SEARCH_PATH, {
      query: { page_size: "20", page_token: "tok1" },
      body: { title_keywords: ["tai nghe"] },
    });
    expect(page).toMatchObject({ nextCursor: "tok2" });
    expect(page.items.map((i) => i.externalItemId)).toEqual(["1"]);
    expect(page.items[0].models[0].price).toBe(100_000);
  });

  it("category search; empty token → null cursor", async () => {
    const call = vi.fn(async () => ({ products: [], next_page_token: "" }));
    const page = await searchTikTokItems({ kind: "category", value: "601450", cursor: null, limit: 10 }, call as never);
    expect(call).toHaveBeenCalledWith(TIKTOK_SEARCH_PATH, { query: { page_size: "10" }, body: { category: { id: "601450" } } });
    expect(page.nextCursor).toBeNull();
  });
});

describe("fetchTikTokItems (T1)", () => {
  it("GETs by comma-separated ids (no body) and keys the result by id", async () => {
    const call = vi.fn(async () => ({ products: [p("9"), p("1729")] }));
    const found = await fetchTikTokItems(["1729", "9", "404"], call as never);
    expect(call).toHaveBeenCalledWith(TIKTOK_PRODUCTS_BY_ID_PATH, { query: { product_ids: "1729,9,404" } });
    expect([...found.keys()].sort()).toEqual(["1729", "9"]);
  });

  it("splits into requests of at most 50 ids and drops duplicates", async () => {
    const ids = Array.from({ length: 120 }, (_, i) => String(i));
    const call = vi.fn(async () => ({ products: [] }));
    await fetchTikTokItems([...ids, "0"], call as never);
    const sizes = call.mock.calls.map((c) => ((c as unknown[])[1] as { query: { product_ids: string } }).query.product_ids.split(",").length);
    expect(sizes).toEqual([50, 50, 20]);
  });

  it("ignores products that were not asked for", async () => {
    const call = vi.fn(async () => ({ products: [p("other")] }));
    expect((await fetchTikTokItems(["1"], call as never)).size).toBe(0);
  });
});

describe("fetchTikTokItem", () => {
  it("returns the requested product", async () => {
    const call = vi.fn(async () => ({ products: [p("1729")] }));
    expect((await fetchTikTokItem("1729", call as never)).externalItemId).toBe("1729");
    expect(call).toHaveBeenCalledWith(TIKTOK_PRODUCTS_BY_ID_PATH, { query: { product_ids: "1729" } });
  });

  it("missing from the result → not found (never gone)", async () => {
    const call = vi.fn(async () => ({ products: [] }));
    await expect(fetchTikTokItem("1729", call as never)).rejects.toBeInstanceOf(MarketplaceItemNotFoundError);
  });
});
