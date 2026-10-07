import { describe, expect, it } from "vitest";
import { savingsFor, summarizeSavings, type PurchaseSnapshot } from "@/lib/watch/savings";

const snap = (o: Partial<PurchaseSnapshot> = {}): PurchaseSnapshot => ({
  purchasedAt: "2026-09-10T03:00:00Z",
  purchasedPrice: 900_000,
  median30d: 1_000_000,
  medianDays: 20,
  baselinePrice: 1_100_000,
  ...o,
});

describe("savingsFor", () => {
  it("below the median → saved, with the baseline difference", () => {
    expect(savingsFor(snap())).toEqual({ status: "saved", vsMedian: 100_000, vsBaseline: 200_000 });
  });
  it("above the median → above (negative)", () => {
    expect(savingsFor(snap({ purchasedPrice: 1_050_000 }))).toMatchObject({ status: "above", vsMedian: -50_000 });
  });
  it("within 1,000 ₫ → flat", () => {
    expect(savingsFor(snap({ purchasedPrice: 999_500 })).status).toBe("flat");
  });
  it("no price or 13 median days → unknown", () => {
    expect(savingsFor(snap({ purchasedPrice: null }))).toEqual({ status: "unknown", vsMedian: null, vsBaseline: null });
    expect(savingsFor(snap({ medianDays: 13 }))).toMatchObject({ status: "unknown", vsMedian: null, vsBaseline: 200_000 });
  });
  it("no baseline → vsBaseline null", () => {
    expect(savingsFor(snap({ baselinePrice: null })).vsBaseline).toBeNull();
  });
});

describe("summarizeSavings", () => {
  it("net total includes the line bought above the median; unknown lines are not counted", () => {
    const lines = [
      savingsFor(snap()), // +100,000
      savingsFor(snap({ purchasedPrice: 1_030_000 })), // −30,000
      savingsFor(snap({ purchasedPrice: 999_800 })), // +200 (flat)
      savingsFor(snap({ medianDays: 3 })), // unknown
    ];
    expect(summarizeSavings(lines)).toEqual({ counted: 3, total: 70_200 });
  });
  it("empty → zero", () => expect(summarizeSavings([])).toEqual({ counted: 0, total: 0 }));
});
