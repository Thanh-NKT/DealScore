import { describe, expect, it } from "vitest";
import {
  parseSellerVoucherHistory,
  productVoucherLine,
  voucherPatternCopy,
  voucherPatterns,
  voucherShapeLabel,
  voucherSummaryCopy,
  type SellerVoucherHistory,
} from "@/lib/vouchers/patterns";

const now = new Date("2026-10-08T03:00:00Z");
const shape = (days: string[], o = {}) => ({ discountType: "amount" as const, discountValue: 50_000, maxDiscount: null, minSpend: 500_000, hasCode: true, days, ...o });
const hist = (o: Partial<SellerVoucherHistory> = {}): SellerVoucherHistory => ({
  checkDays: 60,
  firstCheckDay: "2026-07-10",
  checkMonths: ["2026-07", "2026-08", "2026-09", "2026-10"],
  shapes: [],
  ...o,
});

describe("voucherPatterns", () => {
  it("19 check days → insufficient with the counts", () => {
    expect(voucherPatterns(hist({ checkDays: 19 }), now)).toEqual({ status: "insufficient", checkDays: 19, minCheckDays: 20, checkMonths: 4, minCheckMonths: 2 });
  });
  it("one month of checks → insufficient", () => {
    expect(voucherPatterns(hist({ checkMonths: ["2026-10"] }), now).status).toBe("insufficient");
  });
  it("a shape in 3 checked months, 70% of days on 25–31 → late", () => {
    const days = ["2026-07-26", "2026-07-28", "2026-08-25", "2026-08-30", "2026-09-27", "2026-09-29", "2026-09-30", "2026-08-05", "2026-07-12", "2026-09-15"];
    const r = voucherPatterns(hist({ shapes: [shape(days)] }), now);
    expect(r.status).toBe("patterns");
    if (r.status !== "patterns") return;
    expect(r.patterns[0]).toMatchObject({ monthsSeen: 3, monthsChecked: 4, timing: "late", label: "Mã giảm 50.000đ (đơn từ 500.000đ)", seenRecently: false });
    expect(productVoucherLine("Shop A", r)).toBe("Shop A: Mã giảm 50.000đ (đơn từ 500.000đ) có trong 3/4 tháng gần đây, thường vào cuối tháng.");
  });
  it("seen on 9.9 and 10.10 → double_day; recent sighting flagged", () => {
    const r = voucherPatterns(hist({ shapes: [shape(["2026-09-09", "2026-09-08", "2026-10-10", "2026-10-03"], { discountType: "percent", discountValue: 10, maxDiscount: 30_000, minSpend: 0 })] }), now);
    expect(r.status === "patterns" && r.patterns[0]).toMatchObject({ timing: "early", label: "Giảm 10%, tối đa 30.000đ".replace("Giảm", "Mã giảm") });
    const d = voucherPatterns(hist({ shapes: [shape(["2026-09-09", "2026-10-10", "2026-10-03"])] }), now);
    expect(d.status === "patterns" && d.patterns[0]).toMatchObject({ timing: "double_day", seenRecently: true });
  });
  it("months with sightings but no checks are not counted → none", () => {
    const r = voucherPatterns(hist({ checkMonths: ["2026-09", "2026-10"], shapes: [shape(["2026-07-28", "2026-08-28", "2026-09-28"])] }), now);
    expect(r).toEqual({ status: "none", checkDays: 60 });
    expect(voucherSummaryCopy(r)).toBe("DealScore đã kiểm tra 60 ngày, chưa thấy mã nào lặp lại.");
  });
  it("sorted by months seen, then value; at most 3", () => {
    const four = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"];
    const two = ["2026-07-01", "2026-08-01"];
    const r = voucherPatterns(
      hist({ shapes: [shape(two, { discountValue: 90_000 }), shape(four, { discountValue: 10_000 }), shape(four, { discountValue: 20_000 }), shape(two)] }),
      now,
    );
    expect(r.status === "patterns" && r.patterns.map((p) => p.label)).toEqual([
      "Mã giảm 20.000đ (đơn từ 500.000đ)",
      "Mã giảm 10.000đ (đơn từ 500.000đ)",
      "Mã giảm 90.000đ (đơn từ 500.000đ)",
    ]);
  });
});

describe("copy and parsing", () => {
  it("labels, copy, tolerant parse", () => {
    expect(voucherShapeLabel({ discountType: "percent", discountValue: 10, maxDiscount: 30_000, minSpend: 0, hasCode: false })).toBe("Giảm 10%, tối đa 30.000đ");
    expect(voucherPatternCopy({ label: "x", monthsSeen: 2, monthsChecked: 3, daysSeen: 4, lastSeenDay: "2026-10-01", timing: "early", seenRecently: true })).toEqual({
      title: "x",
      months: "Có trong 2/3 tháng gần đây",
      timing: "thường vào đầu tháng",
    });
    expect(
      parseSellerVoucherHistory({ check_days: 3, check_months: ["2026-10"], shapes: [{ discount_type: "amount", discount_value: "5000", min_spend: 0, has_code: true, days: ["2026-10-01", "bad"] }, { discount_type: "x" }] }),
    ).toEqual({ checkDays: 3, firstCheckDay: null, checkMonths: ["2026-10"], shapes: [{ discountType: "amount", discountValue: 5000, maxDiscount: null, minSpend: 0, hasCode: true, days: ["2026-10-01"] }] });
  });
});
