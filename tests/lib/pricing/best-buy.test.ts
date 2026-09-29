import { describe, expect, it } from "vitest";
import { buyPrice, pickBestBuy } from "@/lib/pricing/best-buy";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";

function offer(
  id: string,
  marketplace: string,
  price: number | null,
  effectivePrice: number | null = null,
  inStock = true,
): PricedOffer {
  return { offerId: id, marketplace, price, effectivePrice, inStock } as PricedOffer;
}

describe("buyPrice", () => {
  it("is the effective price when it is lower than the listed price", () => {
    expect(buyPrice(offer("a", "shopee", 1_000_000, 900_000))).toBe(900_000);
  });

  it("falls back to the listed price when there is no lower effective price", () => {
    expect(buyPrice(offer("a", "shopee", 1_000_000))).toBe(1_000_000);
    expect(buyPrice(offer("a", "shopee", 1_000_000, 1_000_000))).toBe(1_000_000);
    expect(buyPrice(offer("a", "shopee", 1_000_000, 1_200_000))).toBe(1_000_000);
  });

  it("is null without a usable listed price", () => {
    expect(buyPrice(offer("a", "shopee", null, 900_000))).toBeNull();
    expect(buyPrice(offer("a", "shopee", 0))).toBeNull();
  });
});

describe("pickBestBuy", () => {
  it("picks the marketplace that is cheaper after vouchers, even if its listed price is higher", () => {
    const best = pickBestBuy([offer("s", "shopee", 1_000_000), offer("t", "tiktok", 1_050_000, 950_000)]);
    expect(best?.offerId).toBe("t");
  });

  it("keeps the listed-price winner when vouchers do not change the order", () => {
    const best = pickBestBuy([offer("s", "shopee", 900_000), offer("t", "tiktok", 1_050_000, 950_000)]);
    expect(best?.offerId).toBe("s");
  });

  it("breaks a tie on the price you pay by the lower listed price, then by list order", () => {
    expect(pickBestBuy([offer("t", "tiktok", 1_000_000, 900_000), offer("s", "shopee", 900_000)])?.offerId).toBe("s");
    expect(pickBestBuy([offer("a", "shopee", 900_000), offer("b", "tiktok", 900_000)])?.offerId).toBe("a");
  });

  it("ignores out-of-stock offers and offers without a price", () => {
    const best = pickBestBuy([
      offer("gone", "tiktok", 500_000, 400_000, false),
      offer("none", "tiktok", null),
      offer("s", "shopee", 1_000_000),
    ]);
    expect(best?.offerId).toBe("s");
  });

  it("is null when nothing is in stock", () => {
    expect(pickBestBuy([offer("gone", "shopee", 500_000, null, false)])).toBeNull();
    expect(pickBestBuy([])).toBeNull();
  });
});
