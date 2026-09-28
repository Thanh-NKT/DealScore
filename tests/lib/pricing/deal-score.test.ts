import { describe, expect, it } from "vitest";
import { computeDealScore, detectFakeSale, type PriceObservation } from "@/lib/pricing/deal-score";

const NOW = new Date("2026-06-15T03:00:00Z"); // 10:00 Vietnam time

/** One observation per day, at 12:00 Vietnam time, from `days - 1` days ago to today. */
function daily(days: number, price: (i: number) => number, base = NOW): PriceObservation[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(base.getTime() - (days - 1 - i) * 86_400_000);
    return { observed_at: `${d.toISOString().slice(0, 10)}T05:00:00.000Z`, price: price(i) };
  });
}

describe("computeDealScore — percentile mid-rank", () => {
  it("a flat price is NOT scored 🔴 Don't buy yet", () => {
    const r = computeDealScore({ price: 1000, history: daily(30, () => 1000), now: NOW });
    expect(r.stats.percentileRank).toBe(0.5);
    expect(r.recommendation).not.toBe("avoid");
    expect(r.reasons).toContain("✓ Đang ở mức đáy ghi nhận");
  });

  it("a price within 0.5% of the low is worded, never 'cao hơn 0%'", () => {
    const r = computeDealScore({ price: 1003, history: daily(30, (i) => 1000 + i * 20), now: NOW });
    expect(r.reasons).toContain("✓ Gần như bằng mức đáy ghi nhận");
    expect(r.reasons.join(" ")).not.toMatch(/cao hơn 0%/);
  });

  it("a price below all history has rank 0, above all history rank 1", () => {
    const hist = daily(30, (i) => 1000 + i * 10);
    expect(computeDealScore({ price: 900, history: hist, now: NOW }).stats.percentileRank).toBe(0);
    expect(computeDealScore({ price: 5000, history: hist, now: NOW }).stats.percentileRank).toBe(1);
  });

  it("a price equal to one historical level counts only half of the ties", () => {
    // 1000, 1100, 1200, 1300 ×(several days each) — price 1100 has 1/4 below, 1/4 equal.
    const hist = daily(40, (i) => 1000 + Math.floor(i / 10) * 100);
    const r = computeDealScore({ price: 1100, history: hist, now: NOW });
    expect(r.stats.percentileRank).toBeCloseTo(0.25 + 0.125);
  });
});

describe("computeDealScore — the now parameter", () => {
  it("can backtest at a point in the past", () => {
    const past = new Date("2025-01-10T03:00:00Z");
    const hist = daily(30, (i) => 1000 + i, past);
    expect(computeDealScore({ price: 990, history: hist, now: past }).score).not.toBeNull();
    // Same data, computed as of "today" it has fallen outside the 90-day window.
    expect(computeDealScore({ price: 990, history: hist, now: NOW }).recommendation).toBe(
      "insufficient_data",
    );
  });

  it("ignores observations after now", () => {
    const hist = daily(30, () => 1000);
    const earlier = new Date(NOW.getTime() - 5 * 86_400_000);
    expect(computeDealScore({ price: 1000, history: hist, now: earlier }).stats.observations).toBe(
      25,
    );
  });
});

describe("detectFakeSale", () => {
  it("≥20% off the list price while the price is around the median → warning", () => {
    expect(detectFakeSale({ currentPrice: 1000, listedPrice: 1400, median30d: 1000 })).not.toBeNull();
  });

  it("real discount (price clearly below median) → no warning", () => {
    expect(detectFakeSale({ currentPrice: 800, listedPrice: 1400, median30d: 1000 })).toBeNull();
  });

  it("14-day median >15% above the preceding 60 days → pre-sale price hike warning", () => {
    expect(
      detectFakeSale({
        currentPrice: 1000,
        listedPrice: 0,
        median30d: 1000,
        median14dBeforeSale: 1200,
        median60dBefore: 1000,
      }),
    ).toBe("Giá tăng gần đây trước đợt giảm.");
  });
});
