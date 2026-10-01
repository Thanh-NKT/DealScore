import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchShopeeItem, searchShopeeItems } from "@/lib/shopee/affiliate-source";
import { MarketplaceItemNotFoundError, MarketplaceUnavailableError } from "@/lib/marketplaces/types";
import { getSource } from "@/lib/marketplaces/sources";

const env = { SHOPEE_AFFILIATE_APP_ID: "app", SHOPEE_AFFILIATE_SECRET: "s" };
const node = { itemId: 2, shopId: 1, productName: "SSD", priceMin: "100000" };

function graphql(data: unknown) {
  const f = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", f);
  return f;
}
const sentVariables = (f: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).variables;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchShopeeItem", () => {
  it("queries by shopId + itemId and normalizes the first node", async () => {
    const f = graphql({ data: { productOfferV2: { nodes: [node], pageInfo: { hasNextPage: false } } } });
    const item = await fetchShopeeItem("1_2", env);
    expect(item.externalItemId).toBe("1_2");
    expect(sentVariables(f)).toEqual({ shopId: 1, itemId: 2, limit: 1 });
  });

  it("no node → not found (never gone)", async () => {
    graphql({ data: { productOfferV2: { nodes: [], pageInfo: { hasNextPage: false } } } });
    await expect(fetchShopeeItem("1_2", env)).rejects.toBeInstanceOf(MarketplaceItemNotFoundError);
  });

  it("rate limit → MarketplaceUnavailableError tagged shopee", async () => {
    graphql({ errors: [{ message: "x", extensions: { code: 10030 } }] });
    const err = await fetchShopeeItem("1_2", env).catch((e) => e);
    expect(err).toBeInstanceOf(MarketplaceUnavailableError);
    expect(err.marketplace).toBe("shopee");
  });

  it("malformed external id → plain error", async () => {
    await expect(fetchShopeeItem("abc", env)).rejects.toThrow("Invalid Shopee external id");
  });
});

describe("searchShopeeItems", () => {
  it("keyword search, page from cursor, limit capped at 50, next cursor", async () => {
    const f = graphql({ data: { productOfferV2: { nodes: [node, { bad: 1 }], pageInfo: { hasNextPage: true } } } });
    const page = await searchShopeeItems({ kind: "keyword", value: "ssd", cursor: "3", limit: 200 }, env);
    expect(sentVariables(f)).toEqual({ keyword: "ssd", sortType: 2, page: 3, limit: 50 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe("4");
  });

  it("category search uses productCatId; last page → null cursor", async () => {
    const f = graphql({ data: { productOfferV2: { nodes: [], pageInfo: { hasNextPage: false } } } });
    const page = await searchShopeeItems({ kind: "category", value: "100013", cursor: null, limit: 20 }, env);
    expect(sentVariables(f)).toEqual({ productCatId: 100013, sortType: 2, page: 1, limit: 20 });
    expect(page.nextCursor).toBeNull();
  });
});

describe("shopeeSource with real env", () => {
  it("is configured by the affiliate keys and is not fake", () => {
    vi.stubEnv("SHOPEE_CLIENT", "");
    vi.stubEnv("SHOPEE_AFFILIATE_APP_ID", "app");
    vi.stubEnv("SHOPEE_AFFILIATE_SECRET", "s");
    expect(getSource("shopee")!.isConfigured()).toBe(true);
    expect(getSource("shopee")!.isFake()).toBe(false);
  });
});
