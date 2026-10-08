import { describe, expect, it } from "vitest";
import { computeSellerProfile, isoWeek, sellerProfileCopy, sellerProfileView, type OfferDay } from "@/lib/sellers/profile";
import { fakeSaleForPrice } from "@/lib/pricing/variant-pricing";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

const now = new Date("2026-10-08T03:00:00Z");
const dayStr = (i: number) => new Date(Date.UTC(2026, 9, 7) - i * 86_400_000).toISOString().slice(0, 10);
/** 90 days of rollup at `price`. */
const rollup = (price: number, n = 120): DailyPriceRow[] =>
  Array.from({ length: n }, (_, i) => ({
    day: dayStr(n - 1 - i), min_price: price, median_price: price, max_price: price, obs_count: 1, offer_count: 1, has_flash_sale: false, flash_min_price: null,
  }));
const days = (n: number, f: (i: number) => Partial<OfferDay> = () => ({})): OfferDay[] =>
  Array.from({ length: n }, (_, i) => ({ day: dayStr(n - 1 - i), minPrice: 100_000, listPrice: null, ...f(i) }));

describe("isoWeek", () => {
  it("ISO weeks across a year end", () => {
    expect(isoWeek("2026-10-05")).toBe("2026-W41");
    expect(isoWeek("2026-10-11")).toBe("2026-W41");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2025-12-29")).toBe("2026-W01");
  });
});

describe("computeSellerProfile", () => {
  const rows = new Map([["v", rollup(100_000)]]);
  it("a 3-week list-price sale = 3 claims (one per offer-week), counted doubtful like fakeSaleForPrice", () => {
    // last 21 days: list 200k vs price 100k (= median) → list_inflated
    const d = days(60, (i) => (i >= 39 ? { listPrice: 200_000 } : {}));
    const p = computeSellerProfile({ offers: [{ offerId: "o1", variantId: "v", days: d }], variantRows: rows, now });
    const weeks = new Set(d.filter((x) => x.listPrice).map((x) => isoWeek(x.day)));
    expect(p.claimWeeks).toBe(weeks.size);
    expect(weeks.size).toBeGreaterThanOrEqual(3);
    expect(p.doubtfulWeeks).toBe(p.claimWeeks);
    const last = d[d.length - 1];
    const f = fakeSaleForPrice({ price: last.minPrice, originalPrice: last.listPrice, rows: rows.get("v")!.filter((r) => r.day <= last.day), now: new Date(`${last.day}T05:00:00Z`) });
    expect(f).toEqual({ checked: true, kind: "list_inflated" });
  });
  it("stability: swing per offer with ≥ 14 days; stable under 5%", () => {
    const p = computeSellerProfile({
      offers: [
        { offerId: "a", variantId: "v", days: days(20) },
        { offerId: "b", variantId: "v", days: days(20, (i) => ({ minPrice: i % 2 ? 100_000 : 120_000 })) },
        { offerId: "c", variantId: "v", days: days(10) },
      ],
      variantRows: rows,
      now,
    });
    expect(p).toMatchObject({ offersTracked: 2, stableOffers: 1, claimWeeks: 0 });
    expect(p.medianSwing).toBeCloseTo(0.0909, 3);
  });
});

describe("sellerProfileView", () => {
  const base = { offersTracked: 5, claimWeeks: 12, claimOffers: 4, doubtfulWeeks: 3, hikeWeeks: 1, medianSwing: 0.031, stableOffers: 4, computedAt: "2026-10-07T00:00:00Z" };
  it("ok with both facts", () => {
    expect(sellerProfileView(base, now)).toEqual({
      status: "ok", offersTracked: 5, stability: { medianSwingPct: 3.1, stableOffers: 4 },
      discounts: { claimWeeks: 12, doubtfulWeeks: 3, hikeWeeks: 1, doubtfulPct: 25 }, computedAt: base.computedAt,
    });
  });
  it("2 tracked offers → no stability; 9 claim weeks → no discounts; both → insufficient with counts", () => {
    const v = sellerProfileView({ ...base, offersTracked: 2, claimWeeks: 9 }, now);
    expect(v).toEqual({ status: "insufficient", offersTracked: 2, minOffers: 3, claimWeeks: 9, minClaimWeeks: 10 });
    expect(sellerProfileCopy(v!).insufficient).toBe("Chưa đủ dữ liệu: mới theo dõi 2/3 tin bán đủ 14 ngày, 9/10 lần ghi giảm giá.");
    expect(sellerProfileView({ ...base, claimOffers: 2 }, now)).toMatchObject({ status: "ok", discounts: null });
  });
  it("a profile 9 days old is hidden", () => {
    expect(sellerProfileView({ ...base, computedAt: "2026-09-29T00:00:00Z" }, now)).toBeNull();
    expect(sellerProfileView(null, now)).toBeNull();
  });
});
