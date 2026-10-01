import { describe, expect, it, vi } from "vitest";
import { fetchTikTokItem, searchTikTokItems, TIKTOK_SEARCH_PATH } from "@/lib/tiktok/affiliate-source";
import { MarketplaceItemNotFoundError } from "@/lib/marketplaces/types";

const p = (id: string) => ({ id, title: `P${id}`, sale_price: { minimum_amount: "100000", currency: "VND" }, shop: { id: "s1", name: "S" } });

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
  });

  it("category search; empty token → null cursor", async () => {
    const call = vi.fn(async () => ({ products: [], next_page_token: "" }));
    const page = await searchTikTokItems({ kind: "category", value: "601450", cursor: null, limit: 10 }, call as never);
    expect(call).toHaveBeenCalledWith(TIKTOK_SEARCH_PATH, { query: { page_size: "10" }, body: { category: { id: "601450" } } });
    expect(page.nextCursor).toBeNull();
  });
});

describe("fetchTikTokItem (T1)", () => {
  it("filters by product id and returns the exact match", async () => {
    const call = vi.fn(async () => ({ products: [p("9"), p("1729")] }));
    const item = await fetchTikTokItem("1729", call as never);
    expect(item.externalItemId).toBe("1729");
    expect(call).toHaveBeenCalledWith(TIKTOK_SEARCH_PATH, { query: { page_size: "20" }, body: { product_ids: ["1729"] } });
  });

  it("no exact match → not found", async () => {
    const call = vi.fn(async () => ({ products: [p("9")] }));
    await expect(fetchTikTokItem("1729", call as never)).rejects.toBeInstanceOf(MarketplaceItemNotFoundError);
  });
});
