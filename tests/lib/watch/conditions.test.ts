import { describe, expect, it } from "vitest";
import { evaluateConditions } from "@/lib/watch/conditions";
import type { VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";
import type { DealScoreResult } from "@/lib/pricing/deal-score";

const cfg = (o: Partial<WatchConfig> = {}): WatchConfig => ({
  targetPrice: null,
  dropPct: null,
  notifyLow: false,
  minDealScore: null,
  notifyBackInStock: false,
  channels: null,
  ...o,
});
const st = (o: Partial<WatchState> = {}): WatchState => ({
  baselinePrice: null,
  condState: {},
  lastAlertPrice: null,
  lastAlertedAt: null,
  lastInStock: null,
  ...o,
});
const deal = (score: number | null, low: number | null): DealScoreResult => ({
  score,
  recommendation: score == null ? "insufficient_data" : "buy",
  reasons: [],
  stats: { observations: 30, daysCovered: 30, low, median: null, high: null, percentileRank: null },
});
const snap = (o: Partial<VariantSnapshot> = {}): VariantSnapshot => ({
  variantId: "v",
  price: 1000,
  inStock: true,
  offerId: "o",
  observedAt: "2026-09-23T00:00:00Z",
  isStale: false,
  deal: null,
  ...o,
});

describe("evaluateConditions", () => {
  it("chỉ trả các điều kiện Watch có bật", () => {
    expect(Object.keys(evaluateConditions(cfg({ targetPrice: 1000 }), st(), snap()))).toEqual(["target_price"]);
  });

  it("stale → mọi điều kiện unknown", () => {
    const r = evaluateConditions(cfg({ targetPrice: 1, notifyLow: true }), st(), snap({ isStale: true }));
    expect(r).toEqual({ target_price: "unknown", low: "unknown" });
  });

  it("target: ≤ ngưỡng true; hết hàng false", () => {
    expect(evaluateConditions(cfg({ targetPrice: 1000 }), st(), snap({ price: 1000 })).target_price).toBe(true);
    expect(evaluateConditions(cfg({ targetPrice: 1000 }), st(), snap({ price: 1001 })).target_price).toBe(false);
    expect(evaluateConditions(cfg({ targetPrice: 1000 }), st(), snap({ price: 900, inStock: false })).target_price).toBe(false);
  });

  it("trễ 2%: đang true, giá ở T×1.01 vẫn true; T×1.03 thành false; đang false thì T×1.01 là false", () => {
    const on = st({ condState: { target_price: true } });
    expect(evaluateConditions(cfg({ targetPrice: 1000 }), on, snap({ price: 1010 })).target_price).toBe(true);
    expect(evaluateConditions(cfg({ targetPrice: 1000 }), on, snap({ price: 1030 })).target_price).toBe(false);
    expect(evaluateConditions(cfg({ targetPrice: 1000 }), st(), snap({ price: 1010 })).target_price).toBe(false);
  });

  it("drop_pct: baseline null → unknown; ngưỡng = B × (1 − X%)", () => {
    expect(evaluateConditions(cfg({ dropPct: 10 }), st(), snap()).drop_pct).toBe("unknown");
    expect(evaluateConditions(cfg({ dropPct: 10 }), st({ baselinePrice: 1000 }), snap({ price: 900 })).drop_pct).toBe(true);
    expect(evaluateConditions(cfg({ dropPct: 10 }), st({ baselinePrice: 1000 }), snap({ price: 901 })).drop_pct).toBe(false);
  });

  it("low: chưa đủ dữ liệu → unknown; ≤ đáy → true", () => {
    expect(evaluateConditions(cfg({ notifyLow: true }), st(), snap({ deal: deal(null, null) })).low).toBe("unknown");
    expect(evaluateConditions(cfg({ notifyLow: true }), st(), snap({ price: 900, deal: deal(80, 900) })).low).toBe(true);
    expect(evaluateConditions(cfg({ notifyLow: true }), st(), snap({ price: 950, deal: deal(60, 900) })).low).toBe(false);
  });

  it("deal_score: trễ 2 điểm", () => {
    const c = cfg({ minDealScore: 75 });
    expect(evaluateConditions(c, st(), snap({ deal: deal(75, 1) })).deal_score).toBe(true);
    expect(evaluateConditions(c, st(), snap({ deal: deal(74, 1) })).deal_score).toBe(false);
    expect(evaluateConditions(c, st({ condState: { deal_score: true } }), snap({ deal: deal(73, 1) })).deal_score).toBe(true);
    expect(evaluateConditions(c, st({ condState: { deal_score: true } }), snap({ deal: deal(72, 1) })).deal_score).toBe(false);
    expect(evaluateConditions(c, st(), snap({ deal: deal(null, null) })).deal_score).toBe("unknown");
  });

  it("back_in_stock: chưa có lần trước → unknown; hết → còn → true", () => {
    const c = cfg({ notifyBackInStock: true });
    expect(evaluateConditions(c, st(), snap()).back_in_stock).toBe("unknown");
    expect(evaluateConditions(c, st({ lastInStock: false }), snap({ inStock: true })).back_in_stock).toBe(true);
    expect(evaluateConditions(c, st({ lastInStock: true }), snap({ inStock: true })).back_in_stock).toBe(false);
  });
});
