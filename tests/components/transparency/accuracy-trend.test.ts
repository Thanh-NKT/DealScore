import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccuracyTrend } from "@/components/transparency/accuracy-trend";

const trend = [
  { ranAt: "2026-09-24T00:00:00Z", overall: 0.6 },
  { ranAt: "2026-10-01T00:00:00Z", overall: null },
  { ranAt: "2026-10-08T00:00:00Z", overall: 0.7 },
];

describe("AccuracyTrend", () => {
  it("axis labels are HTML text-micro (never SVG text that shrinks with the width at 375px)", () => {
    const html = renderToStaticMarkup(createElement(AccuracyTrend, { trend }));
    expect(html).not.toContain("<text");
    expect(html).toMatch(/text-micro[^>]*>.*100%/);
    // vi-VN date separator differs between ICU builds ("24/09" vs "24-09").
    expect(html).toMatch(/<span>24.09<\/span><span>08.10<\/span>/);
    expect(html).toMatch(/aria-label="Tỉ lệ kết luận đúng qua 2 lần kiểm tra, từ 60% \(24.09\) đến 70% \(08.10\)\."/);
  });

  it("nothing under 2 points", () => {
    expect(renderToStaticMarkup(createElement(AccuracyTrend, { trend: trend.slice(0, 2) }))).toBe("");
  });
});
