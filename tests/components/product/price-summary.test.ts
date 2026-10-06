import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceSummary } from "@/components/product/price-summary";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";

function offer(over: Partial<PricedOffer> = {}): PricedOffer {
  return {
    offerId: "o1",
    marketplace: "tiktok",
    listingUrl: "https://shop.tiktok.com/x",
    listingStatus: "active",
    matchStatus: "auto",
    sellerName: "Shop",
    sellerRating: null,
    sellerRatingCount: null,
    sellerIsOfficial: false,
    affiliateEligible: false,
    price: 800_000,
    originalPrice: 1_000_000,
    stock: 3,
    isFlashSale: false,
    observedAt: new Date().toISOString(),
    inStock: true,
    discountPercent: 20,
    fakeSaleMessage: null,
    discountChecked: true,
    ...over,
  };
}

const render = (o: PricedOffer) => renderToStaticMarkup(createElement(PriceSummary, { cheapest: o, offerCount: 2 }));
const SOLID_CHIP = "bg-buy px-2.5";

describe("PriceSummary — the seller's list-price discount", () => {
  it("verified against history → the solid discount chip and 'Tiết kiệm'", () => {
    const html = render(offer());
    expect(html).toContain(SOLID_CHIP);
    expect(html).toContain("Tiết kiệm");
  });

  it("flagged by the fake-sale check → no discount chip, 'Giảm giá chưa thực chất'", () => {
    const html = render(offer({ fakeSaleMessage: "Mức giảm so với giá niêm yết chưa phản ánh giá thực tế thường ghi nhận." }));
    expect(html).not.toContain(SOLID_CHIP);
    expect(html).not.toContain("Tiết kiệm");
    expect(html).toContain("Giảm giá chưa thực chất");
  });

  it("not checkable yet → a neutral chip, never presented as a real saving", () => {
    const html = render(offer({ discountChecked: false }));
    expect(html).not.toContain(SOLID_CHIP);
    expect(html).not.toContain("Tiết kiệm");
    expect(html).toContain("−20%");
    expect(html).toContain("chưa đủ lịch sử để kiểm tra");
  });
});
