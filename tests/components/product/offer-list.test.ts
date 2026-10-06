import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferList } from "@/components/product/offer-list";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";

function offer(over: Partial<PricedOffer> = {}): PricedOffer {
  return {
    offerId: "o1",
    marketplace: "shopee",
    listingUrl: "https://shopee.vn/x",
    listingStatus: "active",
    matchStatus: "auto",
    sellerName: "Shop A",
    sellerRating: 4.9,
    sellerRatingCount: 120,
    sellerIsOfficial: false,
    affiliateEligible: false,
    price: 1_000_000,
    originalPrice: null,
    stock: 5,
    isFlashSale: false,
    observedAt: new Date().toISOString(),
    inStock: true,
    discountPercent: null,
    fakeSaleMessage: null,
    discountChecked: false,
    ...over,
  };
}

const render = (offers: PricedOffer[], bestBuyId?: string | null) =>
  renderToStaticMarkup(createElement(OfferList, { offers, bestBuyId }));

describe("OfferList", () => {
  it("a rating count of 0 renders no stray 0 next to the stars", () => {
    const html = render([offer({ sellerRatingCount: 0 })]);
    expect(html).toContain("4,9 ★");
    expect(html).not.toMatch(/★<\/b>0/);
    expect(html).not.toContain("(0)");
  });

  it("a positive rating count is shown", () => {
    expect(render([offer({ sellerRatingCount: 120 })])).toContain("(120)");
  });
});

describe("OfferList — one 'best' offer, the same one the hero's buy button goes to", () => {
  const cheapListed = offer({ offerId: "a", price: 1_000_000 });
  const bestAfterVoucher = offer({ offerId: "b", price: 1_050_000, effectivePrice: 900_000, sellerName: "Shop B" });

  it("badges the best buy, not the cheapest listed price, when they differ", () => {
    const html = render([cheapListed, bestAfterVoucher], "b");
    expect(html.match(/Giá tốt nhất/g)).toHaveLength(1);
    const badge = html.indexOf("Giá tốt nhất");
    expect(html.indexOf("Shop B")).toBeGreaterThan(badge);
    expect(html.indexOf("Shop A")).toBeLessThan(badge);
  });

  it("without a best buy id it falls back to the cheapest listed offer", () => {
    const html = render([cheapListed, bestAfterVoucher]);
    expect(html.indexOf("Shop A")).toBeGreaterThan(html.indexOf("Giá tốt nhất"));
  });
});

describe("OfferList — after-voucher estimate", () => {
  it("is marked as an estimate", () => {
    const html = render([offer({ effectivePrice: 900_000 })]);
    expect(html).toContain("~");
    expect(html).toContain("Ước tính");
  });
});
