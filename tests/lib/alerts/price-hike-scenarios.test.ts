import { describe, expect, it } from "vitest";
import { applyNextState, decideAlert } from "@/lib/watch/decide";
import { applyHikeNext, decideHikeAlert, detectPriceHike, type PriceHikeSignal } from "@/lib/watch/price-hike";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import type { VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

// No-spam contract of the price-hike alert (roadmap P2 item C), run like scenarios.test.ts.
const cfg = (o: Partial<WatchConfig> = {}): WatchConfig => ({
  targetPrice: null,
  dropPct: null,
  notifyLow: false,
  minDealScore: null,
  notifyBackInStock: false,
  channels: null,
  notifyPriceHike: true,
  ...o,
});
const start: WatchState = { baselinePrice: 1000, condState: {}, lastAlertPrice: null, lastAlertedAt: null, lastInStock: null };
const PRIOR = 1000;
/** A snapshot whose 14-day median is PRIOR × ratio and whose price is `price` (default the same). */
const snap = (ratio: number | null, o: Partial<VariantSnapshot> & { price?: number } = {}): VariantSnapshot => {
  const hike: PriceHikeSignal | null = ratio == null ? null : { recentMedian: PRIOR * ratio, priorMedian: PRIOR, ratio };
  return {
    variantId: "v",
    price: o.price ?? (ratio == null ? PRIOR : PRIOR * ratio),
    inStock: true,
    offerId: "o",
    observedAt: "x",
    isStale: false,
    deal: null,
    hike,
    ...o,
  };
};
/** Vietnam time, day N of September 2026 (overflows into October). */
const day = (n: number, hhmm = "10:00") => new Date(new Date(`2026-09-01T${hhmm}:00+07:00`).getTime() + (n - 1) * 86_400_000);

type Run = { hike: number[]; main: number[]; state: WatchState };
function run(config: WatchConfig, steps: Array<[Date, VariantSnapshot]>, from: WatchState = start): Run {
  let state = from;
  const hike: number[] = [];
  const main: number[] = [];
  steps.forEach(([now, s], i) => {
    const d = decideAlert(config, state, s, now);
    const h = decideHikeAlert(config, state, s, now, d);
    if (d.kind === "alert") main.push(i);
    if (h.fire) hike.push(i);
    state = applyHikeNext(applyNextState(state, d.nextState), h.next);
  });
  return { hike, main, state };
}
const daily = (n: number, s: (i: number) => VariantSnapshot, from = 1): Array<[Date, VariantSnapshot]> =>
  Array.from({ length: n }, (_, i) => [day(from + i), s(i)]);

describe("H1 — elevated 1.2× for 30 daily runs", () => {
  it("exactly one hike alert, and it never touches the price-drop state", () => {
    const r = run(cfg(), daily(30, () => snap(1.2)));
    expect(r.hike).toEqual([0]);
    expect(r.state.lastAlertedAt).toBeNull();
    expect(r.state.lastAlertPrice).toBeNull();
    expect(r.state.baselinePrice).toBe(1000);
  });
});

describe("H2 — hysteresis and the 7-day cooldown", () => {
  it("1.16 ↔ 1.12 daily → one alert", () => {
    expect(run(cfg(), daily(20, (i) => snap(i % 2 === 0 ? 1.16 : 1.12))).hike).toEqual([0]);
  });

  it("drop to 1.05 then back to 1.2 within 7 days → no 2nd alert; 8 days later → 2nd alert", () => {
    const steps: Array<[Date, VariantSnapshot]> = [
      [day(1), snap(1.2)], // #1
      [day(2), snap(1.05)], // edge cleared
      [day(3), snap(1.2)], // new edge, but in cooldown
      [day(5), snap(1.2)], // still in cooldown
      [day(9), snap(1.2)], // 8 days after #1 → #2
      [day(10), snap(1.2)],
    ];
    expect(run(cfg(), steps).hike).toEqual([0, 4]);
  });
});

describe("H3 — a price-drop alert in the same run wins", () => {
  it("no hike and no hike state written; next run the hike fires", () => {
    // Back in stock + elevated price in the same run: the main alert fires, the hike waits.
    const config = cfg({ notifyBackInStock: true });
    const from: WatchState = { ...start, lastInStock: false };
    const first = snap(1.2);
    const d = decideAlert(config, from, first, day(1));
    expect(d.kind).toBe("alert");
    const h = decideHikeAlert(config, from, first, day(1), d);
    expect(h).toEqual({ fire: false, next: null });
    const r = run(config, [[day(1), first], [day(2), snap(1.2)]], from);
    expect(r.main).toEqual([0]);
    expect(r.hike).toEqual([1]);
  });
});

describe("H3b — a price-drop edge held back by its cooldown also wins", () => {
  it("main suppressed_cooldown → no hike in that run, no hike state written", () => {
    const config = cfg({ notifyBackInStock: true });
    const from: WatchState = { ...start, lastInStock: false, lastAlertedAt: new Date(day(1).getTime() - 2 * 3_600_000).toISOString(), lastAlertPrice: 1000 };
    const s1 = snap(1.2);
    const d = decideAlert(config, from, s1, day(1));
    expect(d.kind).toBe("suppressed_cooldown");
    expect(decideHikeAlert(config, from, s1, day(1), d)).toEqual({ fire: false, next: null });
  });
});

describe("H4 — independent cooldowns", () => {
  it("a hike alert at N1 does not delay a target-price alert at N2", () => {
    const r = run(cfg({ targetPrice: 1100 }), [
      [day(1), snap(1.2)], // hike #1
      [day(2), snap(1.2, { price: 1050 })], // target reached → main alert
    ]);
    expect(r.hike).toEqual([0]);
    expect(r.main).toEqual([1]);
  });
});

describe("H5 — never fires", () => {
  it("stale / out of stock / opted out → no fire, no state write", () => {
    const main = decideAlert(cfg(), start, snap(1.2), day(1));
    for (const [config, s] of [
      [cfg(), snap(1.2, { isStale: true })],
      [cfg(), snap(1.2, { inStock: false })],
      [cfg({ notifyPriceHike: false }), snap(1.2)],
      [cfg({ notifyPriceHike: undefined }), snap(1.2)],
      [cfg(), snap(1.2, { price: null as unknown as number })],
    ] as const) {
      expect(decideHikeAlert(config, start, s, day(1), main)).toEqual({ fire: false, next: null });
    }
  });

  it("price ≤ the target price → no fire, edge cleared", () => {
    const s = snap(1.2);
    const main = decideAlert(cfg({ targetPrice: 1300 }), { ...start, condState: { target_price: true } }, s, day(1));
    expect(decideHikeAlert(cfg({ targetPrice: 1300 }), { ...start, hikeActive: true }, s, day(1), main)).toEqual({
      fire: false,
      next: { hikeActive: false },
    });
  });

  it("no measurement (not enough data) → no fire", () => {
    expect(run(cfg(), daily(10, () => snap(null))).hike).toEqual([]);
  });
});

describe("detectPriceHike thresholds", () => {
  const NOW = new Date("2026-06-15T03:00:00Z");
  /** `recent` days at 1200 in the last 14 (today excluded), `prior` days at 1000 in the 60 before. */
  function rows(recent: number, prior: number): DailyPriceRow[] {
    const out: DailyPriceRow[] = [];
    const push = (daysAgo: number, p: number) =>
      out.push({
        day: new Date(NOW.getTime() - daysAgo * 86_400_000 + 7 * 3_600_000).toISOString().slice(0, 10),
        min_price: p,
        median_price: p,
        max_price: p,
        obs_count: 1,
        offer_count: 1,
        has_flash_sale: false,
        flash_min_price: null,
      });
    for (let i = 0; i < prior; i++) push(15 + i, 1000);
    for (let i = 0; i < recent; i++) push(1 + i, 1200);
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }

  it("enough data and still high → signal", () => {
    expect(detectPriceHike(rows(10, 30), 1200, NOW)).toMatchObject({ recentMedian: 1200, priorMedian: 1000, ratio: 1.2 });
  });
  it("9 recent days → null", () => expect(detectPriceHike(rows(9, 30), 1200, NOW)).toBeNull());
  it("29 prior days → null", () => expect(detectPriceHike(rows(10, 29), 1200, NOW)).toBeNull());
  it("current price back below prior × 1.15 → null", () => expect(detectPriceHike(rows(10, 30), 1100, NOW)).toBeNull());
});
