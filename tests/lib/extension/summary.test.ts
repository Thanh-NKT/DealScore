import { describe, expect, it } from "vitest";
import { buildExtensionSummary } from "@/lib/extension/product";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import type { ProductPageData } from "@/lib/product/page-data";
import { buildVariantPricing, type OfferRow } from "@/lib/pricing/variant-pricing";

const NOW = new Date("2026-06-15T03:00:00Z");
const SITE = "https://dealscore.vn";

function history(days: number, every = 1): DailyPriceRow[] {
  const out: DailyPriceRow[] = [];
  for (let d = days; d >= 1; d -= every) {
    const p = 1000 + (d % 7) * 10;
    out.push({
      day: new Date(NOW.getTime() + 7 * 3_600_000 - d * 86_400_000).toISOString().slice(0, 10),
      min_price: p,
      median_price: p,
      max_price: p,
      obs_count: 1,
      offer_count: 1,
      has_flash_sale: false,
      flash_min_price: null,
    });
  }
  return out;
}

const offer: OfferRow = {
  offerId: "o1",
  marketplace: "shopee",
  listingUrl: "https://shopee.vn/product/1/2",
  listingStatus: "active",
  matchStatus: "auto",
  sellerName: "Shop",
  sellerRating: null,
  sellerRatingCount: null,
  sellerIsOfficial: false,
  affiliateEligible: false,
  price: 1000,
  originalPrice: null,
  stock: 5,
  isFlashSale: false,
  observedAt: NOW.toISOString(),
};

function data(rows: DailyPriceRow[]): ProductPageData {
  return {
    product: { canonicalName: "SSD A", categorySlug: "o-cung-ssd", slug: "ssd-a" },
    variants: [{ id: "v1", variantKey: "1TB" }],
    selectedVariantId: "v1",
    pricing: buildVariantPricing({ offers: [offer], history: rows, trackingSince: null, isDraftProduct: false, now: NOW }),
  } as unknown as ProductPageData;
}

describe("buildExtensionSummary — panel facts", () => {
  it("with history: low / median set, coverage null, compareUrl anchored on the seller list", () => {
    const s = buildExtensionSummary(data(history(60)), SITE);
    expect(s.low90).toBe(1000);
    expect(s.median90).not.toBeNull();
    expect(s.coverage).toBeNull();
    expect(s.compareUrl).toBe(`${s.url}#offers-heading`);
    expect(s.compareUrl.endsWith("#offers-heading")).toBe(true);
  });

  it("a new product (6 days) → coverage { 6, 14 }", () => {
    const s = buildExtensionSummary(data(history(6)), SITE);
    expect(s.recommendation).toBe("insufficient_data");
    expect(s.coverage).toEqual({ days: 6, minDays: 14 });
  });

  it("enough days but too few observations → coverage null", () => {
    // One row every 5 days over 30 days: 6 observations, 30 days covered.
    const s = buildExtensionSummary(data(history(30, 5)), SITE);
    expect(s.score).toBeNull();
    expect(s.coverage).toBeNull();
  });
});
