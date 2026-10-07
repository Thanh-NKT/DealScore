import { describe, expect, it } from "vitest";
import { priceChange, referencePrice } from "@/lib/watch/change";
import { CHANGE_REF_LOOKBACK_DAYS, CHANGE_WINDOW_DAYS } from "@/lib/watch/constants";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

const row = (day: string, min: number | null): DailyPriceRow => ({
  day, min_price: min, median_price: min, max_price: min, obs_count: 1, offer_count: 1,
  has_flash_sale: min == null, flash_min_price: min == null ? 500 : null,
});
// 2026-10-07 12:00 Vietnam time → "today" = 2026-10-07, day −7 = 2026-09-30.
const NOW = new Date("2026-10-07T05:00:00Z");

describe("referencePrice", () => {
  it("uses day −7 when it has a price", () => {
    const rows = [row("2026-09-28", 900), row("2026-09-30", 1000), row("2026-10-01", 1100)];
    expect(referencePrice(rows, 7, NOW)).toBe(1000);
  });

  it("falls back to the latest day within the lookback", () => {
    const rows = [row("2026-09-27", 800), row("2026-09-28", 900), row("2026-10-01", 1100)];
    expect(referencePrice(rows, 7, NOW)).toBe(900);
  });

  it("the lookback is inclusive (day −10 with lookback 3) and stops there", () => {
    expect(referencePrice([row("2026-09-27", 800)], 7, NOW)).toBe(800);
    expect(referencePrice([row("2026-09-26", 700)], 7, NOW)).toBeNull();
    expect(referencePrice([row("2026-09-26", 700)], 7, NOW, 4)).toBe(700);
  });

  it("only day −11 → null", () => {
    expect(referencePrice([row("2026-09-26", 700), row("2026-10-02", 1)], 7, NOW)).toBeNull();
  });

  it("skips flash-only days (min_price null) and non-positive prices", () => {
    expect(referencePrice([row("2026-09-29", 950), row("2026-09-30", null)], 7, NOW)).toBe(950);
    expect(referencePrice([row("2026-09-29", 950), row("2026-09-30", 0)], 7, NOW)).toBe(950);
  });

  it("counts Vietnam calendar days around midnight", () => {
    // 23:30 and 00:30 Vietnam time on 2026-10-07 → same target day −7 = 2026-09-30.
    const late = new Date("2026-10-07T16:30:00Z"); // 23:30 VN on 10-07
    const early = new Date("2026-10-06T17:30:00Z"); // 00:30 VN on 10-07
    const rows = [row("2026-09-29", 900), row("2026-09-30", 1000), row("2026-10-01", 1100)];
    expect(referencePrice(rows, 7, late)).toBe(1000);
    expect(referencePrice(rows, 7, early)).toBe(1000);
    // 23:30 UTC on 10-06 is already 06:30 VN on 10-07 (not 10-06).
    expect(referencePrice(rows, 7, new Date("2026-10-06T23:30:00Z"))).toBe(1000);
  });

  it("empty history → null", () => {
    expect(referencePrice([], CHANGE_WINDOW_DAYS, NOW)).toBeNull();
  });

  it("constants", () => {
    expect(CHANGE_WINDOW_DAYS).toBe(7);
    expect(CHANGE_REF_LOOKBACK_DAYS).toBe(3);
  });
});

describe("priceChange", () => {
  it("current − ref, pct of ref", () => {
    expect(priceChange(800, 1000, 7)).toEqual({ amount: -200, pct: -0.2, refPrice: 1000, days: 7 });
    expect(priceChange(1100, 1000, 7)).toEqual({ amount: 100, pct: 0.1, refPrice: 1000, days: 7 });
    expect(priceChange(1000, 1000, 7)).toEqual({ amount: 0, pct: 0, refPrice: 1000, days: 7 });
  });

  it("null when either side is missing or ≤ 0", () => {
    expect(priceChange(null, 1000, 7)).toBeNull();
    expect(priceChange(1000, null, 7)).toBeNull();
    expect(priceChange(1000, 0, 7)).toBeNull();
    expect(priceChange(0, 1000, 7)).toBeNull();
    expect(priceChange(-5, 1000, 7)).toBeNull();
  });
});
