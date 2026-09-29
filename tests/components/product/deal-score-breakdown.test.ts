import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DealScoreBreakdown } from "@/components/product/deal-score-breakdown";

// Spec 2026-09-28 §4: the voucher reason shows even while the Deal Score is insufficient.
const VOUCHER = "Dùng voucher: ước tính còn 950.000 ₫ (chưa gồm phí ship).";
const render = (props: Parameters<typeof DealScoreBreakdown>[0]) => renderToStaticMarkup(createElement(DealScoreBreakdown, props));

describe("DealScoreBreakdown", () => {
  it("no score → the insufficient-data note PLUS the reasons", () => {
    const html = render({ score: null, recommendation: "insufficient_data", reasons: [VOUCHER] });
    expect(html).toContain("Kairo cần ít nhất");
    expect(html).toContain("Dùng voucher: ước tính còn");
  });

  it("no score and no reasons → only the note", () => {
    const html = render({ score: null, recommendation: "insufficient_data", reasons: [] });
    expect(html).toContain("Kairo cần ít nhất");
    expect(html).not.toContain("Chưa có lý do chi tiết");
  });

  it("with a score → the reasons, no insufficient-data note", () => {
    const html = render({ score: 80, recommendation: "buy", reasons: ["✓ Giá thấp", VOUCHER] });
    expect(html).not.toContain("Kairo cần ít nhất");
    expect(html).toContain("Dùng voucher: ước tính còn");
  });
});
