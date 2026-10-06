import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InteractivePriceChart } from "@/components/product/interactive-price-chart";
import { historyStats, type DailyPriceRow } from "@/lib/pricing/price-history";
import { formatVnd } from "@/lib/format";

const NOW = "2026-03-20T10:00:00Z"; // 17:00 in Vietnam

function day(d: string, p: number | null, flash: number | null = null): DailyPriceRow {
  return {
    day: d,
    min_price: p,
    median_price: p,
    max_price: p,
    obs_count: 1,
    offer_count: 1,
    has_flash_sale: flash != null,
    flash_min_price: flash,
  };
}

const render = (props: Parameters<typeof InteractivePriceChart>[0]) =>
  renderToStaticMarkup(createElement(InteractivePriceChart, { nowIso: NOW, ...props }));

describe("InteractivePriceChart", () => {
  it("starts on the page's ?range= instead of always 90", () => {
    const html = render({ rows: [day("2026-03-19", 1000)], initialRange: 7 });
    expect(html).toContain("Biểu đồ lịch sử giá 7 ngày");
    expect(html).toContain("7 ngày trước");
  });

  it("draws one line per continuous run of days: a gap is never joined", () => {
    const rows = [day("2026-03-15", 1000), day("2026-03-16", 1100), day("2026-03-18", 1200), day("2026-03-19", 1300)];
    const html = render({ rows, initialRange: 7 });
    expect(html.match(/<polyline/g)).toHaveLength(2);
  });

  it("the median is the engine's (mean of the two middle values), not the upper median", () => {
    const rows = [day("2026-03-16", 1000), day("2026-03-17", 2000), day("2026-03-18", 3000), day("2026-03-19", 4000)];
    const html = render({ rows, initialRange: 7 });
    const median = historyStats(rows, new Date(NOW), 7).median!;
    expect(median).toBe(2500);
    expect(html).toMatch(new RegExp(`Giá trung vị</span><span[^>]*>${formatVnd(2500)}<`));
  });

  it("before 07:00 Vietnam time an existing row for the new day stays 'Hôm nay' and is not duplicated", () => {
    const early = "2026-03-20T18:30:00Z"; // 01:30 on 21/03 in Vietnam
    const rows = [day("2026-03-20", 1000), day("2026-03-21", 1100)];
    const html = render({ rows, initialRange: 7, nowIso: early, currentPrice: 1050 });
    expect(html).toContain("Hôm nay");
    expect(html).toContain("Thấp nhất trong ngày");
    expect(html).not.toContain("Giá hiện tại");
  });

  it("flash-sale days are markers, and the legend says they are outside the history", () => {
    const rows = [day("2026-03-18", 1000), day("2026-03-19", 1000, 700)];
    const html = render({ rows, initialRange: 7 });
    expect(html.match(/data-flash=""/g)).toHaveLength(1);
    expect(html).toContain("không tính vào lịch sử giá");
  });

  it("is keyboard reachable and announces the inspected day", () => {
    const html = render({ rows: [day("2026-03-19", 1000)], initialRange: 7 });
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-live="polite"');
  });
});
