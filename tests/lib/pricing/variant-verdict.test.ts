import { describe, expect, it } from "vitest";
import {
  SCORE_PRICE_TOLERANCE,
  VARIANT_SCORE_MAX_AGE_HOURS,
  asRecommendation,
  variantVerdict,
  type CachedVariantScore,
} from "@/lib/pricing/variant-verdict";
import type { DealScoreResult } from "@/lib/pricing/deal-score";

const NOW = new Date("2026-10-07T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const headline = (score: number | null, recommendation: DealScoreResult["recommendation"] = "buy"): DealScoreResult => ({
  score, recommendation, reasons: [], stats: { observations: 20, daysCovered: 30, low: 1, median: 1, high: 1, percentileRank: 0.1 },
});
const cached = (o: Partial<CachedVariantScore> = {}): CachedVariantScore => ({
  score: 64, recommendation: "wait", priceAtCompute: 1_000_000, computedAt: hoursAgo(2), ...o,
});
const variant = (o: Partial<{ id: string; price: number | null; inStock: boolean }> = {}) => ({
  id: "other", price: 1_000_000, inStock: true, ...o,
});

describe("variantVerdict", () => {
  it("constants", () => {
    expect(VARIANT_SCORE_MAX_AGE_HOURS).toBe(48);
    expect(SCORE_PRICE_TOLERANCE).toBe(1);
  });

  it("selected variant uses the live headline even when the cache differs", () => {
    const v = variantVerdict({ variant: variant({ id: "sel" }), selectedId: "sel", headline: headline(82.4), cached: cached(), now: NOW });
    expect(v).toEqual({ kind: "score", score: 82, recommendation: "buy", live: true });
    expect(variantVerdict({ variant: variant({ id: "sel" }), selectedId: "sel", headline: headline(null, "insufficient_data"), cached: cached(), now: NOW }))
      .toEqual({ kind: "insufficient", live: true });
    expect(variantVerdict({ variant: variant({ id: "sel" }), selectedId: "sel", headline: null, cached: cached(), now: NOW }))
      .toEqual({ kind: "none" });
  });

  it("other variants use the cache only when it still matches the price and is fresh", () => {
    const base = { selectedId: "sel", headline: headline(90), now: NOW };
    expect(variantVerdict({ ...base, variant: variant(), cached: cached() }))
      .toEqual({ kind: "score", score: 64, recommendation: "wait", live: false });
    expect(variantVerdict({ ...base, variant: variant({ price: 1_000_001 }), cached: cached() }).kind).toBe("score");
    expect(variantVerdict({ ...base, variant: variant({ price: 1_000_002 }), cached: cached() })).toEqual({ kind: "none" });
    expect(variantVerdict({ ...base, variant: variant(), cached: cached({ computedAt: hoursAgo(49) }) })).toEqual({ kind: "none" });
    expect(variantVerdict({ ...base, variant: variant(), cached: cached({ computedAt: hoursAgo(47.9) }) }).kind).toBe("score");
    expect(variantVerdict({ ...base, variant: variant(), cached: cached({ priceAtCompute: null }) })).toEqual({ kind: "none" });
    expect(variantVerdict({ ...base, variant: variant(), cached: cached({ computedAt: "not a date" }) })).toEqual({ kind: "none" });
  });

  it("insufficient_data cache → insufficient; out of stock / no price / no cache → none", () => {
    const base = { selectedId: "sel", headline: headline(90), now: NOW };
    expect(variantVerdict({ ...base, variant: variant(), cached: cached({ recommendation: "insufficient_data", score: null }) }))
      .toEqual({ kind: "insufficient", live: false });
    expect(variantVerdict({ ...base, variant: variant(), cached: cached({ score: null }) })).toEqual({ kind: "insufficient", live: false });
    expect(variantVerdict({ ...base, variant: variant({ inStock: false }), cached: cached() })).toEqual({ kind: "none" });
    expect(variantVerdict({ ...base, variant: variant({ price: null }), cached: cached() })).toEqual({ kind: "none" });
    expect(variantVerdict({ ...base, variant: variant(), cached: null })).toEqual({ kind: "none" });
  });

  it("an unknown cached recommendation shows nothing (asRecommendation maps it to null)", () => {
    for (const r of ["buy", "wait", "avoid", "insufficient_data"]) expect(asRecommendation(r)).toBe(r);
    for (const r of ["BUY", "", null, undefined, 3]) expect(asRecommendation(r)).toBeNull();
    const base = { selectedId: "sel", headline: headline(90), now: NOW, variant: variant() };
    expect(variantVerdict({ ...base, cached: cached({ recommendation: asRecommendation("maybe") }) })).toEqual({ kind: "none" });
  });

  it("rounds and clamps the score like ScoreRing", () => {
    const base = { selectedId: "sel", headline: headline(90), now: NOW, variant: variant() };
    expect(variantVerdict({ ...base, cached: cached({ score: 101 }) })).toMatchObject({ score: 100 });
    expect(variantVerdict({ ...base, cached: cached({ score: 63.5 }) })).toMatchObject({ score: 64 });
  });
});
