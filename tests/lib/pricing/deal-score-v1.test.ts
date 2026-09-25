import { describe, expect, it } from "vitest";
import { computeDealScore, type PriceObservation } from "@/lib/pricing/deal-score";
import { computeDealScoreV1, MAX_TOTAL_ADJUSTMENT } from "@/lib/pricing/deal-score-v1";
import { DEAL_SCORE_VERSION, scoreDeal } from "@/lib/pricing/score";

const NOW = new Date("2026-06-15T03:00:00Z"); // 10:00 Vietnam time

function daily(days: number, price: (i: number) => number): PriceObservation[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(NOW.getTime() - (days - 1 - i) * 86_400_000);
    return { observed_at: `${d.toISOString().slice(0, 10)}T05:00:00.000Z`, price: price(i) };
  });
}

/** ~6% wobble (cv between the 3% "stable" and 15% "volatile" thresholds), no trend. */
const calm = daily(60, (i) => [1000, 1060, 1120, 1060][i % 4]);

describe("computeDealScoreV1", () => {
  it("equals v0 when no adjustment applies", () => {
    const input = { price: 1005, history: calm, now: NOW };
    const v0 = computeDealScore(input);
    const v1 = computeDealScoreV1(input);
    expect(v1.version).toBe("v1");
    expect(v1.base).toBe(v0.score);
    expect(v1.adjustments.filter((a) => a.delta !== 0)).toEqual([]);
    expect(v1.score).toBe(v0.score);
    expect(v1.recommendation).toBe(v0.recommendation);
  });

  it("leaves insufficient_data untouched", () => {
    const input = { price: 1000, history: daily(5, () => 1000), now: NOW, stock: 2 };
    const v1 = computeDealScoreV1(input);
    expect(v1.recommendation).toBe("insufficient_data");
    expect(v1.score).toBeNull();
    expect(v1.adjustments).toEqual([]);
  });

  it("penalizes a falling trend and says why", () => {
    // 53 days around 1000, then the last 7 days at 900 → m7 is 10% under m30.
    const history = daily(60, (i) => (i >= 53 ? 900 : 1000 + (i % 2) * 10));
    const v1 = computeDealScoreV1({ price: 900, history, now: NOW });
    const trend = v1.adjustments.find((a) => a.kind === "trend")!;
    expect(trend.delta).toBeLessThan(0);
    expect(trend.delta).toBeGreaterThanOrEqual(-8);
    expect(trend.reason).toMatch(/đang đi xuống/);
    expect(v1.reasons).toContain(trend.reason);
  });

  it("penalizes high volatility unless the price is at the low", () => {
    const history = daily(60, (i) => (i % 2 === 0 ? 800 : 1200));
    const above = computeDealScoreV1({ price: 1000, history, now: NOW });
    expect(above.adjustments.find((a) => a.kind === "volatility")?.delta).toBe(-5);
    const atLow = computeDealScoreV1({ price: 800, history, now: NOW });
    expect(atLow.adjustments.find((a) => a.kind === "volatility")).toBeUndefined();
  });

  it("rewards a very stable price at or under the median", () => {
    const history = daily(60, () => 1000);
    const v1 = computeDealScoreV1({ price: 1000, history, now: NOW });
    expect(v1.adjustments.find((a) => a.kind === "volatility")?.delta).toBe(3);
  });

  it("low stock adds a reason, and points only when the base score is good", () => {
    const good = computeDealScoreV1({ price: 1000, history: calm, now: NOW, stock: 3 });
    const stock = good.adjustments.find((a) => a.kind === "stock")!;
    expect(stock.reason).toBe("⚠ Chỉ còn 3 sản phẩm");
    expect(stock.delta).toBe(good.base! >= 60 ? 3 : 0);
    const bad = computeDealScoreV1({ price: 2000, history: calm, now: NOW, stock: 3 });
    expect(bad.adjustments.find((a) => a.kind === "stock")?.delta).toBe(0);
  });

  it("seller quality: low rating −5, official shop +2", () => {
    const low = computeDealScoreV1({ price: 1005, history: calm, now: NOW, seller: { rating: 4.2, isOfficial: false } });
    expect(low.adjustments.find((a) => a.kind === "seller")).toMatchObject({ delta: -5 });
    expect(low.reasons.join(" ")).toMatch(/4\.2\/5/);
    const mall = computeDealScoreV1({ price: 1005, history: calm, now: NOW, seller: { rating: null, isOfficial: true } });
    expect(mall.adjustments.find((a) => a.kind === "seller")).toMatchObject({ delta: 2 });
  });

  it("caps the total adjustment at ±15 and the score at 0–100", () => {
    const history = daily(60, (i) => (i >= 53 ? 600 : i % 2 === 0 ? 700 : 1300));
    const v1 = computeDealScoreV1({ price: 1300, history, now: NOW, seller: { rating: 3.9, isOfficial: false } });
    const total = v1.adjustments.reduce((s, a) => s + a.delta, 0);
    expect(total).toBeLessThan(-MAX_TOTAL_ADJUSTMENT); // raw sum exceeds the cap…
    expect(v1.score! - v1.base!).toBeGreaterThanOrEqual(-MAX_TOTAL_ADJUSTMENT); // …but the applied change doesn't
    expect(v1.score).toBeGreaterThanOrEqual(0);
  });

  it("keeps at most 4 reasons", () => {
    const history = daily(60, (i) => (i >= 53 ? 900 : i % 2 === 0 ? 800 : 1200));
    const v1 = computeDealScoreV1({ price: 950, history, now: NOW, stock: 2, seller: { rating: 4.0, isOfficial: false } });
    expect(v1.reasons.length).toBeLessThanOrEqual(4);
    expect(v1.reasons.length).toBeGreaterThanOrEqual(2);
  });
});

describe("scoreDeal", () => {
  it("uses v1 by default", () => {
    expect(DEAL_SCORE_VERSION).toBe("v1");
    const r = scoreDeal({ price: 1005, history: calm, now: NOW });
    expect(r).toEqual(computeDealScoreV1({ price: 1005, history: calm, now: NOW }));
  });
  it("can be forced to v0", () => {
    const r = scoreDeal({ price: 1005, history: calm, now: NOW }, "v0");
    expect(r).toEqual(computeDealScore({ price: 1005, history: calm, now: NOW }));
  });
});
