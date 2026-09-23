import { describe, expect, it } from "vitest";
import { computeDealScore } from "@/lib/pricing/deal-score";
import { expandRollup, type DailyPriceRow } from "@/lib/pricing/price-history";
import {
  buildVariantPricing,
  FLASH_SALE_REASON,
  isOfferVisible,
  type OfferRow,
} from "@/lib/pricing/variant-pricing";

/** Fixed clock (10:00 Vietnam time), passed in via `now`. */
const NOW = new Date("2026-06-15T03:00:00Z");

function offer(over: Partial<OfferRow> = {}): OfferRow {
  return {
    offerId: "o1",
    marketplace: "shopee",
    listingUrl: "https://shopee.vn/product/1/2",
    listingStatus: "active",
    matchStatus: "auto",
    sellerName: "Shop A",
    sellerRating: 4.8,
    sellerRatingCount: 120,
    sellerIsOfficial: false,
    affiliateEligible: true,
    price: 1000,
    originalPrice: null,
    stock: 5,
    isFlashSale: false,
    observedAt: NOW.toISOString(),
    ...over,
  };
}

function history(days: number, price: (i: number) => number): DailyPriceRow[] {
  return Array.from({ length: days }, (_, i) => {
    const daysAgo = days - 1 - i;
    const p = price(i);
    return {
      day: new Date(NOW.getTime() - daysAgo * 86_400_000)
        .toISOString()
        .slice(0, 10),
      min_price: p,
      median_price: p,
      max_price: p,
      obs_count: 1,
      offer_count: 1,
      has_flash_sale: false,
      flash_min_price: null,
    };
  });
}

const HIST = history(60, (i) => 1000 + (i % 10) * 20);

describe("isOfferVisible", () => {
  it("shows automatically or manually matched offers", () => {
    expect(isOfferVisible(offer({ matchStatus: "auto" }), false)).toBe(true);
    expect(isOfferVisible(offer({ matchStatus: "manual" }), false)).toBe(true);
  });

  it("hides pending offers on verified products — uncertain means don't assert", () => {
    expect(isOfferVisible(offer({ matchStatus: "pending" }), false)).toBe(false);
  });

  it("shows pending offers on ingest-created draft products", () => {
    expect(isOfferVisible(offer({ matchStatus: "pending" }), true)).toBe(true);
  });

  it("hides rejected offers, even on draft products", () => {
    expect(isOfferVisible(offer({ matchStatus: "rejected" }), true)).toBe(false);
  });

  it("hides offers whose listing is no longer active", () => {
    expect(isOfferVisible(offer({ listingStatus: "inactive" }), true)).toBe(false);
  });
});

describe("buildVariantPricing — sorting", () => {
  const base = {
    history: HIST,
    trackingSince: null,
    isDraftProduct: false,
    now: NOW,
  };

  it("in stock first, ascending price within each group", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({ offerId: "b", price: 900, stock: 0 }),
        offer({ offerId: "c", price: 1200 }),
        offer({ offerId: "a", price: 1000 }),
      ],
    });
    expect(out.offers.map((o) => o.offerId)).toEqual(["a", "c", "b"]);
  });

  it("offers without a price go last", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ offerId: "x", price: null }), offer({ offerId: "y", price: 1000 })],
    });
    expect(out.offers.map((o) => o.offerId)).toEqual(["y", "x"]);
  });

  it("skips out-of-stock offers when choosing the cheapest", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({ offerId: "a", price: 800, stock: 0 }),
        offer({ offerId: "b", price: 900 }),
      ],
    });
    expect(out.cheapest?.offerId).toBe("b");
  });

  it("no score when every offer is out of stock", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 900, stock: 0 })],
    });
    expect(out.cheapest).toBeNull();
    expect(out.headline).toBeNull();
  });
});

describe("buildVariantPricing — header score (decision Đ7)", () => {
  const base = {
    history: HIST,
    trackingSince: null,
    isDraftProduct: false,
    now: NOW,
  };

  it("does NOT pass bestOffer, so the score is lower than with bestOffer = itself", () => {
    // The price must sit INSIDE the historical range (1000–1180). A price below the low makes both
    // computations hit the 100 ceiling and the test can't tell them apart.
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1100 })] });

    const inflated = computeDealScore({
      price: 1100,
      history: expandRollup(HIST),
      bestOffer: 1100, // cBetween always = 100 → an unearned +20
      now: NOW,
    });

    expect(out.headline).not.toBeNull();
    expect(out.headline!.score).toBeLessThan(inflated.score!);
  });

  it("the cheapest offer's row must NOT show a score different from the header", () => {
    // If the per-offer loop passed bestOffer = the cheapest offer itself, component
    // 3 would always be 100 and that row would show up to 20 points above the header.
    // The user would see two contradicting numbers on the same screen.
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ offerId: "a", price: 1100 }), offer({ offerId: "b", price: 1400 })],
    });
    expect(out.cheapest?.dealScore?.score).toBe(out.headline?.score);
  });

  it("a pricier offer scores lower than the cheapest", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ offerId: "a", price: 900 }), offer({ offerId: "b", price: 1500 })],
    });
    const a = out.offers.find((o) => o.offerId === "a")!;
    const b = out.offers.find((o) => o.offerId === "b")!;
    expect(a.dealScore!.score).toBeGreaterThan(b.dealScore!.score!);
  });
});

describe("buildVariantPricing — Fake Sale only runs with enough data", () => {
  const base = { trackingSince: null, isDraftProduct: false, now: NOW };

  it("no label when history is too short", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 900, originalPrice: 2000 })],
      history: history(5, () => 1000),
    });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("no label when the list price is missing", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 1000, originalPrice: null })],
      history: history(40, () => 1000),
    });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("labels a big list discount while the price is around its usual level", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [offer({ price: 1000, originalPrice: 2000 })], // 50% off the list price
      history: history(40, () => 1000), // yet exactly at the median
    });
    expect(out.fakeSaleMessage).not.toBeNull();
  });
});

describe("buildVariantPricing — data freshness", () => {
  const base = {
    history: HIST,
    trackingSince: null,
    isDraftProduct: false,
    now: NOW,
  };

  it("marks stale when the newest observation is older than 48 hours", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          observedAt: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(true);
  });

  it("not stale when data is within 48 hours", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          observedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(false);
  });

  it("freshness only counts displayable offers", () => {
    // A hidden offer must not make the data look fresher than it is.
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({
          offerId: "hien",
          observedAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
        }),
        offer({
          offerId: "an",
          listingStatus: "inactive",
          observedAt: NOW.toISOString(),
        }),
      ],
    });
    expect(out.isStale).toBe(true);
  });
});

describe("buildVariantPricing — out of stock at every seller (1.2.a.4, 1.2.e)", () => {
  const base = { history: HIST, trackingSince: null, isDraftProduct: false, now: NOW };

  it("no score, but keeps the most recent price to show 'Tạm hết hàng'", () => {
    const out = buildVariantPricing({
      ...base,
      offers: [
        offer({ offerId: "a", price: 900, stock: 0, observedAt: "2026-06-10T00:00:00Z" }),
        offer({ offerId: "b", price: 950, stock: 0, observedAt: "2026-06-14T00:00:00Z" }),
      ],
    });
    expect(out.cheapest).toBeNull();
    expect(out.headline).toBeNull();
    expect(out.allOutOfStock).toBe(true);
    expect(out.lastKnown?.offerId).toBe("b");
    expect(out.lastKnown?.inStock).toBe(false);
  });

  it("in stock → no lastKnown", () => {
    const out = buildVariantPricing({ ...base, offers: [offer()] });
    expect(out.allOutOfStock).toBe(false);
    expect(out.lastKnown).toBeNull();
  });

  it("no price yet is not an out-of-stock state", () => {
    const out = buildVariantPricing({ ...base, offers: [offer({ price: null, stock: 0 })] });
    expect(out.allOutOfStock).toBe(false);
  });
});

describe("buildVariantPricing — StatsRow numbers (1.2.d.3)", () => {
  it("still has low / median / high when the Deal Score is below threshold", () => {
    const short = history(5, (i) => 1000 + i * 100);
    const out = buildVariantPricing({
      offers: [offer({ price: 1000 })],
      history: short,
      trackingSince: short[0].day,
      isDraftProduct: false,
      now: NOW,
    });
    expect(out.headline?.recommendation).toBe("insufficient_data");
    expect(out.stats).toEqual({ low: 1000, median: 1200, high: 1400, dayCount: 5 });
  });

  it("once above threshold, matches the Deal Score stats", () => {
    const out = buildVariantPricing({
      offers: [offer({ price: 1100 })],
      history: HIST,
      trackingSince: null,
      isDraftProduct: false,
      now: NOW,
    });
    const { low, median, high } = out.headline!.stats;
    expect(out.stats).toMatchObject({ low, median, high });
  });
});

describe("buildVariantPricing — flash sale", () => {
  it("a current flash price prepends a warning reason, score unchanged", () => {
    const base = { history: HIST, trackingSince: null, isDraftProduct: false, now: NOW };
    const normal = buildVariantPricing({ ...base, offers: [offer({ price: 900 })] });
    const flash = buildVariantPricing({ ...base, offers: [offer({ price: 900, isFlashSale: true })] });
    expect(flash.headline!.score).toBe(normal.headline!.score);
    expect(flash.headline!.reasons[0]).toBe(FLASH_SALE_REASON);
    expect(flash.headline!.reasons.length).toBeLessThanOrEqual(4);
    expect(normal.headline!.reasons).not.toContain(FLASH_SALE_REASON);
  });
});

describe("buildVariantPricing — pre-sale price hike heuristic", () => {
  // 60 days at 1000, then the latest 14 days at 1300: 14-day median > 60-day × 1.15.
  const raised = history(75, (i) => (i >= 60 ? 1300 : 1000));
  const base = { history: raised, trackingSince: null, isDraftProduct: false, now: NOW };

  it("price only rose, NO sale → no label", () => {
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1300 })] });
    expect(out.fakeSaleMessage).toBeNull();
  });

  it("price rose then 'dropped' back to the old level → labelled", () => {
    const out = buildVariantPricing({ ...base, offers: [offer({ price: 1150 })] });
    expect(out.fakeSaleMessage).toBe("Giá tăng gần đây trước đợt giảm.");
  });
});
