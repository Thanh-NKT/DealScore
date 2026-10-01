import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configuredMarketplaces, getSource } from "@/lib/marketplaces/sources";
import { MarketplaceUnavailableError } from "@/lib/marketplaces/types";

beforeEach(() => {
  // Real keys in the shell must not leak into these expectations (Tasks 5 and 8 make them count).
  for (const k of ["SHOPEE_AFFILIATE_APP_ID", "SHOPEE_AFFILIATE_SECRET", "TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET", "TIKTOK_SHOP_SERVICE_ID"]) {
    vi.stubEnv(k, "");
  }
});
afterEach(() => vi.unstubAllEnvs());

describe("sources", () => {
  it("no env → nothing configured; Lazada has no source at all", () => {
    vi.stubEnv("SHOPEE_CLIENT", "");
    vi.stubEnv("TIKTOK_CLIENT", "");
    expect(configuredMarketplaces()).toEqual([]);
    expect(getSource("lazada")).toBeNull();
    expect(getSource("nope")).toBeNull();
  });

  it("fake flags enable dev sources, never in production", () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("TIKTOK_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    expect(configuredMarketplaces()).toEqual(["shopee", "tiktok"]);
    vi.stubEnv("NODE_ENV", "production");
    expect(configuredMarketplaces()).toEqual([]);
  });

  it("fake Shopee item is a seed MarketplaceItem with one priced model", async () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    const item = await getSource("shopee")!.fetchItem("123_456");
    expect(item).toMatchObject({
      marketplace: "shopee",
      externalItemId: "123_456",
      url: "https://shopee.vn/product/123/456",
      source: "seed",
      seller: { externalId: "123" },
    });
    expect(item.models[0].price).toBeGreaterThan(0);
    expect(getSource("shopee")!.isFake()).toBe(true);
  });

  it("fake TikTok item uses the canonical TikTok URL", async () => {
    vi.stubEnv("TIKTOK_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    const item = await getSource("tiktok")!.fetchItem("1729384756");
    expect(item).toMatchObject({ marketplace: "tiktok", url: "https://www.tiktok.com/view/product/1729384756", source: "seed" });
  });

  it("fake search pages end after page 2", async () => {
    vi.stubEnv("SHOPEE_CLIENT", "fake");
    vi.stubEnv("NODE_ENV", "development");
    const p1 = await getSource("shopee")!.searchItems({ kind: "keyword", value: "ssd", cursor: null, limit: 3 });
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).toBe("2");
    const p2 = await getSource("shopee")!.searchItems({ kind: "keyword", value: "ssd", cursor: "2", limit: 3 });
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...p1.items, ...p2.items].map((i) => i.externalItemId)).size).toBe(6);
  });

  it("unconfigured source refuses to fetch with MarketplaceUnavailableError", async () => {
    vi.stubEnv("SHOPEE_CLIENT", "");
    await expect(getSource("shopee")!.fetchItem("1_2")).rejects.toBeInstanceOf(MarketplaceUnavailableError);
  });
});
