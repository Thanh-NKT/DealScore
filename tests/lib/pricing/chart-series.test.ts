import { describe, expect, it } from "vitest";
import { buildChartSeries } from "@/lib/pricing/chart-series";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

const NOW = new Date("2026-03-20T10:00:00Z");

/** prices[0] là ngày xa nhất, phần tử cuối là hôm nay. */
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
  it("gom các ngày liên tiếp thành một đoạn", () => {
    const s = buildChartSeries(rows([1000, 1100, 1200]), 7, NOW);
    expect(s.segments).toHaveLength(1);
    expect(s.segments[0]).toHaveLength(3);
  });

  it("NGẮT đoạn ở ngày thiếu dữ liệu — không nội suy qua chỗ trống", () => {
    const s = buildChartSeries(rows([1000, null, 1200]), 7, NOW);
    expect(s.segments).toHaveLength(2);
  });

  it("ngắt đoạn cả khi dòng ngày đó vắng mặt hoàn toàn", () => {
    const all = rows([1000, 1100, 1200]);
    const withHole = [all[0], all[2]]; // bỏ hẳn dòng ngày giữa
    const s = buildChartSeries(withHole, 7, NOW);
    expect(s.segments).toHaveLength(2);
  });

  it("cắt theo rangeDays", () => {
    const s = buildChartSeries(rows(Array(40).fill(1000)), 7, NOW);
    expect(s.segments.flat().length).toBeLessThanOrEqual(8);
  });

  it("không vẽ được khi có dưới 2 điểm", () => {
    expect(buildChartSeries(rows([1000]), 7, NOW).renderable).toBe(false);
    expect(buildChartSeries([], 7, NOW).renderable).toBe(false);
  });

  it("trục y phải bao được cả marker flash sale, nếu không marker rơi ngoài khung", () => {
    // Marker flash sale được vẽ trên chính chart này (spec UI §8), nên min/max
    // phải tính cả nó. Flash ở đây là 500, thấp hơn mọi giá thường.
    const s = buildChartSeries(rows([1000, 1500, 800], [1]), 7, NOW);
    expect(s.min).toBe(500);
    expect(s.max).toBe(1500);
  });

  it("không có flash sale thì min/max chỉ theo giá thường", () => {
    const s = buildChartSeries(rows([1000, 1500, 800]), 7, NOW);
    expect(s.min).toBe(800);
    expect(s.max).toBe(1500);
  });

  it("sinh marker cho ngày có flash sale", () => {
    const s = buildChartSeries(rows([1000, 1100, 1200], [1]), 7, NOW);
    expect(s.flashMarkers).toHaveLength(1);
    expect(s.flashMarkers[0].price).toBe(500);
  });

  it("không sinh marker khi thiếu flash_min_price", () => {
    const r = rows([1000, 1100]);
    r[1].has_flash_sale = true;
    r[1].flash_min_price = null;
    expect(buildChartSeries(r, 7, NOW).flashMarkers).toHaveLength(0);
  });
});
