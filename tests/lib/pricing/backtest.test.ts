import { describe, expect, it } from "vitest";
import { accuracy, backtestVariant, mergeResults, type BacktestClassifier } from "@/lib/pricing/backtest";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

function series(prices: Array<number | null>, start = "2026-01-01"): DailyPriceRow[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return prices.map((p, i) => ({
    day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    min_price: p,
    median_price: p,
    max_price: p,
    obs_count: p == null ? 0 : 1,
    offer_count: 1,
    has_flash_sale: false,
    flash_min_price: null,
  }));
}

const always =
  (rec: ReturnType<BacktestClassifier>): BacktestClassifier =>
  () =>
    rec;

describe("backtestVariant", () => {
  it("evaluates every stepDays and only where a full horizon follows", () => {
    // 50 days, horizon 30, step 7 → eval days at index 19, 12, 5 (from last-30 backwards).
    const r = backtestVariant(series(Array(50).fill(1000)), { classify: always("buy") });
    expect(r.samples).toBe(3);
    expect(r.buy).toEqual({ n: 3, correct: 3 }); // flat price never dropped → buy is right
  });

  it("wait/avoid are right when the price later drops by at least dropThreshold", () => {
    const prices = [...Array(20).fill(1000), ...Array(30).fill(940)]; // −6% after day 19
    const r = backtestVariant(series(prices), { classify: always("wait"), stepDays: 100 });
    expect(r.wait).toEqual({ n: 1, correct: 1 });
    const r2 = backtestVariant(series(prices), { classify: always("buy"), stepDays: 100 });
    expect(r2.buy).toEqual({ n: 1, correct: 0 });
  });

  it("a drop smaller than the threshold does not count", () => {
    const prices = [...Array(20).fill(1000), ...Array(30).fill(970)]; // −3%
    const r = backtestVariant(series(prices), { classify: always("avoid"), stepDays: 100 });
    expect(r.avoid).toEqual({ n: 1, correct: 0 });
  });

  it("skips insufficient_data and days without a price", () => {
    const prices: Array<number | null> = Array(50).fill(1000);
    prices[19] = null;
    const r = backtestVariant(series(prices), { classify: always("insufficient_data"), stepDays: 1 });
    expect(r.samples).toBe(0);
  });

  it("never shows the classifier data after the evaluation day", () => {
    const seen: Array<[string, string]> = [];
    backtestVariant(series(Array(60).fill(1000)), {
      classify: (_p, history, now) => {
        const last = history.at(-1)!.observed_at;
        seen.push([last, now.toISOString()]);
        return "buy";
      },
    });
    expect(seen.length).toBeGreaterThan(0);
    for (const [last, now] of seen) expect(Date.parse(last)).toBeLessThanOrEqual(Date.parse(now));
  });

  it("runs with the real Deal Score by default", () => {
    const prices = Array.from({ length: 120 }, (_, i) => 1000 + ((i * 37) % 200));
    const r = backtestVariant(series(prices));
    expect(r.samples).toBeGreaterThan(0);
  });
});

describe("mergeResults / accuracy", () => {
  it("adds tallies and computes overall accuracy", () => {
    const a = { samples: 2, buy: { n: 2, correct: 2 }, wait: { n: 0, correct: 0 }, avoid: { n: 0, correct: 0 } };
    const b = { samples: 2, buy: { n: 0, correct: 0 }, wait: { n: 1, correct: 0 }, avoid: { n: 1, correct: 1 } };
    const m = mergeResults([a, b]);
    expect(m).toEqual({ samples: 4, buy: { n: 2, correct: 2 }, wait: { n: 1, correct: 0 }, avoid: { n: 1, correct: 1 } });
    expect(accuracy(m)).toBeCloseTo(0.75);
  });

  it("accuracy is null with no samples", () => {
    expect(accuracy(mergeResults([]))).toBeNull();
  });
});
