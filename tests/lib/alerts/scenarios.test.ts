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
/** Giờ VN → Date. N1 = 2026-09-01. */
const at = (day: number, hhmm: string) =>
  new Date(`2026-09-${String(day).padStart(2, "0")}T${hhmm}:00+07:00`);

/** Chạy tuần tự như engine thật: áp nextState sau mỗi bước. Trả chỉ số các bước có alert. */
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

describe("Kịch bản A — target 1000, mỗi ngày 10:00", () => {
  it("đúng 4 alert ở N2, N6, N7 10:00, N8", () => {
    const alerts = run(cfg({ targetPrice: 1000 }), [
      [at(1, "10:00"), snap(1100)],
      [at(2, "10:00"), snap(990)], // #1
      [at(3, "10:00"), snap(985)],
      [at(4, "10:00"), snap(1015)], // vẫn true nhờ trễ 2%
      [at(5, "10:00"), snap(1030)], // thành false
      [at(6, "10:00"), snap(995)], // #2 cạnh mới
      [at(7, "10:00"), snap(960)], // #3 deeper
      [at(7, "16:00"), snap(900)], // cooldown
      [at(8, "10:00"), snap(900)], // #4 deeper so với 960
    ]);
    expect(alerts).toEqual([1, 5, 6, 8]);
  });
});

describe("Kịch bản B — cooldown không làm mất cạnh", () => {
  it("alert #2 ở N2 09:30", () => {
    const alerts = run(cfg({ targetPrice: 1000 }), [
      [at(1, "09:00"), snap(990)], // #1
      [at(1, "10:00"), snap(1030)], // false được ghi
      [at(1, "12:00"), snap(990)], // cooldown — condState vẫn false
      [at(2, "09:30"), snap(990)], // #2
    ]);
    expect(alerts).toEqual([0, 3]);
  });
});

describe("Kịch bản C — có hàng lại", () => {
  it("đúng 1 alert khi hết → còn", () => {
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

describe("Kịch bản D — giá đứng yên 30 ngày dưới target", () => {
  it("đúng 1 alert", () => {
    const steps = Array.from({ length: 30 }, (_, i) => [at(i + 1, "10:00"), snap(950)] as [Date, VariantSnapshot]);
    expect(run(cfg({ targetPrice: 1000 }), steps)).toEqual([0]);
  });
});
