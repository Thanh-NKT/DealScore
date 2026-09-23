import { describe, expect, it } from "vitest";
import { applyNextState, decideAlert } from "@/lib/watch/decide";
import type { VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

const cfg = (o: Partial<WatchConfig>): WatchConfig => ({
  targetPrice: null,
  dropPct: null,
  notifyLow: false,
  minDealScore: null,
  notifyBackInStock: false,
  channels: null,
  ...o,
});
const start: WatchState = { baselinePrice: 1100, condState: {}, lastAlertPrice: null, lastAlertedAt: null, lastInStock: null };
const snap = (price: number, inStock = true): VariantSnapshot => ({
  variantId: "v",
  price,
  inStock,
  offerId: "o",
  observedAt: "x",
  isStale: false,
  deal: null,
});
/** Vietnam time → Date. N1 = 2026-09-01. */
const at = (day: number, hhmm: string) =>
  new Date(`2026-09-${String(day).padStart(2, "0")}T${hhmm}:00+07:00`);

/** Runs sequentially like the real engine: applies nextState after each step. Returns the indexes of steps that alerted. */
function run(config: WatchConfig, steps: Array<[Date, VariantSnapshot]>): number[] {
  let state = start;
  const alerts: number[] = [];
  steps.forEach(([now, s], i) => {
    const d = decideAlert(config, state, s, now);
    if (d.kind === "alert") alerts.push(i);
    state = applyNextState(state, d.nextState);
  });
  return alerts;
}

describe("Scenario A — target 1000, daily at 10:00", () => {
  it("exactly 4 alerts at N2, N6, N7 10:00, N8", () => {
    const alerts = run(cfg({ targetPrice: 1000 }), [
      [at(1, "10:00"), snap(1100)],
      [at(2, "10:00"), snap(990)], // #1
      [at(3, "10:00"), snap(985)],
      [at(4, "10:00"), snap(1015)], // still true thanks to 2% hysteresis
      [at(5, "10:00"), snap(1030)], // becomes false
      [at(6, "10:00"), snap(995)], // #2 new edge
      [at(7, "10:00"), snap(960)], // #3 deeper
      [at(7, "16:00"), snap(900)], // cooldown
      [at(8, "10:00"), snap(900)], // #4 deeper relative to 960
    ]);
    expect(alerts).toEqual([1, 5, 6, 8]);
  });
});

describe("Scenario B — cooldown does not lose an edge", () => {
  it("alert #2 at N2 09:30", () => {
    const alerts = run(cfg({ targetPrice: 1000 }), [
      [at(1, "09:00"), snap(990)], // #1
      [at(1, "10:00"), snap(1030)], // false is recorded
      [at(1, "12:00"), snap(990)], // cooldown — condState stays false
      [at(2, "09:30"), snap(990)], // #2
    ]);
    expect(alerts).toEqual([0, 3]);
  });
});

describe("Scenario C — back in stock", () => {
  it("exactly 1 alert on out → in stock", () => {
    const alerts = run(cfg({ notifyBackInStock: true }), [
      [at(1, "10:00"), snap(1000, true)],
      [at(2, "10:00"), snap(1000, false)],
      [at(3, "10:00"), snap(1000, false)],
      [at(4, "10:00"), snap(1000, true)], // alert
      [at(5, "10:00"), snap(1000, true)],
    ]);
    expect(alerts).toEqual([3]);
  });
});

describe("Scenario D — price flat for 30 days below target", () => {
  it("exactly 1 alert", () => {
    const steps = Array.from({ length: 30 }, (_, i) => [at(i + 1, "10:00"), snap(950)] as [Date, VariantSnapshot]);
    expect(run(cfg({ targetPrice: 1000 }), steps)).toEqual([0]);
  });
});
