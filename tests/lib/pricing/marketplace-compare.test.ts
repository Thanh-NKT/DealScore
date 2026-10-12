import { describe, expect, it } from "vitest";
import { compareMarketplaces } from "@/lib/pricing/marketplace-compare";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";

function offer(
  marketplace: string,
  price: number | null,
  inStock = true,
  id = `${marketplace}-${price}`,
  effectivePrice: number | null = null,
): PricedOffer {
  return { offerId: id, marketplace, price, inStock, effectivePrice } as PricedOffer;
}

describe("compareMarketplaces", () => {
  it("returns null with a single marketplace — never simulated", () => {
    expect(compareMarketplaces([offer("shopee", 100), offer("shopee", 90)])).toBeNull();
  });

  it("returns null when the second marketplace has no in-stock price", () => {
    expect(compareMarketplaces([offer("shopee", 100), offer("tiktok", 90, false), offer("tiktok", null)])).toBeNull();
  });

  it("takes each marketplace's cheapest in-stock offer, cheapest first, with gaps", () => {
    const c = compareMarketplaces([
      offer("shopee", 2_500_000),
      offer("shopee", 2_450_000),
      offer("tiktok", 2_330_000),
      offer("tiktok", 2_100_000, false),
    ])!;
    expect(c.rows.map((r) => [r.marketplace, r.price, r.sellers, r.gap])).toEqual([
      ["tiktok", 2_330_000, 1, 0],
      ["shopee", 2_450_000, 2, 120_000],
    ]);
    expect(c.cheapest).toBe("tiktok");
    expect(c.summary).toBe("Rẻ nhất trên TikTok Shop, thấp hơn Shopee 120.000đ (5%).");
  });

  it("ranks marketplaces by the price after vouchers, so a voucher can flip the winner", () => {
    const c = compareMarketplaces([
      offer("shopee", 1_000_000),
      offer("tiktok", 1_050_000, true, "t1", 950_000),
    ])!;
    expect(c.rows.map((r) => [r.marketplace, r.price, r.effectivePrice, r.gap])).toEqual([
      ["tiktok", 1_050_000, 950_000, 0],
      ["shopee", 1_000_000, null, 50_000],
    ]);
    expect(c.cheapest).toBe("tiktok");
    expect(c.summary).toBe("Rẻ nhất trên TikTok Shop sau voucher, thấp hơn Shopee 50.000đ (5%).");
  });

  it("picks each marketplace's offer by the price after vouchers", () => {
    const c = compareMarketplaces([
      offer("shopee", 900_000, true, "s-plain"),
      offer("shopee", 950_000, true, "s-voucher", 800_000),
      offer("tiktok", 1_000_000),
    ])!;
    expect(c.rows[0]).toMatchObject({ marketplace: "shopee", offerId: "s-voucher", price: 950_000, effectivePrice: 800_000 });
    expect(c.summary).toBe("Rẻ nhất trên Shopee sau voucher, thấp hơn TikTok Shop 200.000đ (20%).");
  });

  it("says so when the marketplaces are within 1%", () => {
    const c = compareMarketplaces([offer("shopee", 1_000_000), offer("tiktok", 1_005_000)])!;
    expect(c.summary).toBe("Giá trên các sàn gần như bằng nhau.");
  });
});
