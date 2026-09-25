import { describe, expect, it } from "vitest";
import { compareMarketplaces } from "@/lib/pricing/marketplace-compare";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";

function offer(marketplace: string, price: number | null, inStock = true, id = `${marketplace}-${price}`): PricedOffer {
  return { offerId: id, marketplace, price, inStock } as PricedOffer;
}

describe("compareMarketplaces", () => {
  it("returns null with a single marketplace — never simulated", () => {
    expect(compareMarketplaces([offer("shopee", 100), offer("shopee", 90)])).toBeNull();
  });

  it("returns null when the second marketplace has no in-stock price", () => {
    expect(compareMarketplaces([offer("shopee", 100), offer("lazada", 90, false), offer("tiktok", null)])).toBeNull();
  });

  it("takes each marketplace's cheapest in-stock offer, cheapest first, with gaps", () => {
    const c = compareMarketplaces([
      offer("shopee", 2_500_000),
      offer("shopee", 2_450_000),
      offer("lazada", 2_330_000),
      offer("lazada", 2_100_000, false),
      offer("tiktok", 2_600_000),
    ])!;
    expect(c.rows.map((r) => [r.marketplace, r.price, r.sellers, r.gap])).toEqual([
      ["lazada", 2_330_000, 1, 0],
      ["shopee", 2_450_000, 2, 120_000],
      ["tiktok", 2_600_000, 1, 270_000],
    ]);
    expect(c.cheapest).toBe("lazada");
    expect(c.summary).toBe("Rẻ nhất trên Lazada, thấp hơn Shopee 120.000đ (5%).");
  });

  it("says so when the marketplaces are within 1%", () => {
    const c = compareMarketplaces([offer("shopee", 1_000_000), offer("lazada", 1_005_000)])!;
    expect(c.summary).toBe("Giá trên các sàn gần như bằng nhau.");
  });
});
