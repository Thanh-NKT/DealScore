import { describe, expect, it } from "vitest";
import { buildChartSeries } from "@/lib/pricing/chart-series";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

const NOW = new Date("2026-03-20T10:00:00Z");

/** prices[0] is the oldest day, the last element is today. */
function rows(prices: Array<number | null>, flashIdx: number[] = []): DailyPriceRow[] {
  return prices.map((p, i) => {
    const daysAgo = prices.length - 1 - i;
    return {
      day: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10),
      min_price: p,
      median_price: p,
      max_price: p,
      obs_count: p == null ? 0 : 1,
      offer_count: p == null ? 0 : 1,
      has_flash_sale: flashIdx.includes(i),
      flash_min_price: flashIdx.includes(i) ? 500 : null,
    };
  });
}

describe("buildChartSeries", () => {
  it("groups consecutive days into one segment", () => {
    const s = buildChartSeries(rows([1000, 1100, 1200]), 7, NOW);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toHaveLength(3);
  });

  it("BREAKS the segment on a day without data — no interpolation across gaps", () => {
    const s = buildChartSeries(rows([1000, null, 1200]), 7, NOW);
    expect(s.segments).toHaveLength(2);
  });

  it("also breaks when that day's row is entirely absent", () => {
    const all = rows([1000, 1100, 1200]);
    const withHole = [all[0], all[2]]; // drop the middle day's row entirely
    const s = buildChartSeries(withHole, 7, NOW);
    expect(s.segments).toHaveLength(2);
  });

  it("trims by rangeDays", () => {
    const s = buildChartSeries(rows(Array(40).fill(1000)), 7, NOW);
    expect(s.segments.flat().length).toBeLessThanOrEqual(8);
  });

  it("cannot draw with fewer than 2 points", () => {
    expect(buildChartSeries(rows([1000]), 7, NOW).renderable).toBe(false);
    expect(buildChartSeries([], 7, NOW).renderable).toBe(false);
  });

  it("the y axis must include flash sale markers, or they fall outside the frame", () => {
    // Flash sale markers are drawn on this very chart (UI spec §8), so min/max
    // must include them. The flash price here is 500, below every regular price.
    const s = buildChartSeries(rows([1000, 1500, 800], [1]), 7, NOW);
    expect(s.min).toBe(500);
    expect(s.max).toBe(1500);
  });

  it("without flash sales, min/max follow regular prices only", () => {
    const s = buildChartSeries(rows([1000, 1500, 800]), 7, NOW);
    expect(s.min).toBe(800);
    expect(s.max).toBe(1500);
  });

  it("creates a marker for days with a flash sale", () => {
    const s = buildChartSeries(rows([1000, 1100, 1200], [1]), 7, NOW);
    expect(s.flashMarkers).toHaveLength(1);
    expect(s.flashMarkers[0].price).toBe(500);
  });

  it("no marker when flash_min_price is missing", () => {
    const r = rows([1000, 1100]);
    r[1].has_flash_sale = true;
    r[1].flash_min_price = null;
    expect(buildChartSeries(r, 7, NOW).flashMarkers).toHaveLength(0);
  });
});

describe("buildChartSeries — calendar window in Vietnam time", () => {
  const day = (d: string, p: number | null): DailyPriceRow => ({
    day: d,
    min_price: p,
    median_price: p,
    max_price: p,
    obs_count: 1,
    offer_count: 1,
    has_flash_sale: false,
    flash_min_price: null,
  });

  it("'7 days' is days today−7 … today — the historyStats window, not the last 7 data points", () => {
    const s = buildChartSeries(rows(Array(40).fill(1000)), 7, NOW);
    expect(s.points).toHaveLength(8);
    expect(s.fromDay).toBe("2026-03-13");
    expect(s.today).toBe("2026-03-20");
    expect(s.points.map((p) => p.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("sparse data keeps its real position on the time axis", () => {
    // Two points 20 days apart in a 30-day window: x = days since the window start, not 0 and 1.
    const s = buildChartSeries([day("2026-02-28", 1000), day("2026-03-20", 1100)], 30, NOW);
    expect(s.points.map((p) => p.x)).toEqual([10, 30]);
    expect(s.segments).toHaveLength(2);
  });

  it("drops rows older than the window", () => {
    const s = buildChartSeries([day("2026-03-12", 1000), day("2026-03-13", 1100)], 7, NOW);
    expect(s.points.map((p) => p.day)).toEqual(["2026-03-13"]);
  });

  it("between 00:00 and 07:00 Vietnam time 'today' is already the new Vietnam day", () => {
    const earlyMorning = new Date("2026-03-20T18:30:00Z"); // 01:30 on 21/03 in Vietnam
    const s = buildChartSeries([day("2026-03-20", 1000), day("2026-03-21", 1100)], 7, earlyMorning, {
      currentPrice: 1050,
    });
    expect(s.today).toBe("2026-03-21");
    // Today's row exists: no extra point dated yesterday after it, and order is kept.
    expect(s.points.map((p) => p.day)).toEqual(["2026-03-20", "2026-03-21"]);
    expect(s.points.some((p) => p.current)).toBe(false);
  });

  it("the current price becomes today's point when the rollup has no row for today yet", () => {
    const s = buildChartSeries([day("2026-03-19", 1000)], 7, NOW, { currentPrice: 900 });
    expect(s.points.at(-1)).toEqual({ day: "2026-03-20", price: 900, x: 7, current: true });
    expect(s.segments).toHaveLength(1); // yesterday → today is continuous
  });

  it("a flash-sale current price is a flash marker, never part of the regular line", () => {
    const s = buildChartSeries([day("2026-03-19", 1000)], 7, NOW, { currentPrice: 600, currentIsFlashSale: true });
    expect(s.points.map((p) => p.day)).toEqual(["2026-03-19"]);
    expect(s.flashMarkers).toEqual([{ day: "2026-03-20", price: 600, x: 7 }]);
    expect(s.min).toBe(600);
  });
});
