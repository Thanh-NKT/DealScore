import { describe, expect, it } from "vitest";
import { decideAlert } from "@/lib/watch/decide";
import type { VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

const cfg: WatchConfig = {
  targetPrice: 1000,
  dropPct: null,
  notifyLow: false,
  minDealScore: null,
  notifyBackInStock: false,
  channels: null,
};
const base: WatchState = { baselinePrice: 1200, condState: {}, lastAlertPrice: null, lastAlertedAt: null, lastInStock: true };
const snap = (price: number, o: Partial<VariantSnapshot> = {}): VariantSnapshot => ({
  variantId: "v",
  price,
  inStock: true,
  offerId: "o",
  observedAt: "x",
  isStale: false,
  deal: null,
  ...o,
});
const NOW = new Date("2026-09-23T03:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("decideAlert", () => {
  it("stale → skip_stale, nextState null", () => {
    expect(decideAlert(cfg, base, snap(900, { isStale: true }), NOW)).toEqual({
      kind: "skip_stale",
      triggerTypes: [],
      nextState: null,
    });
  });

  it("false → true edge → alert", () => {
    const d = decideAlert(cfg, base, snap(990), NOW);
    expect(d.kind).toBe("alert");
    expect(d.triggerTypes).toEqual(["target_price"]);
    expect(d.nextState?.alerted).toEqual({ price: 990, at: NOW.toISOString() });
    expect(d.nextState?.condState).toEqual({ target_price: true });
  });

  it("already true, flat price → no alert", () => {
    const s = { ...base, condState: { target_price: true }, lastAlertPrice: 990, lastAlertedAt: hoursAgo(48) };
    expect(decideAlert(cfg, s, snap(990), NOW).kind).toBe("no_alert");
  });

  it("exactly 3% further → deeper_drop; 2.9% → none", () => {
    const s = { ...base, condState: { target_price: true }, lastAlertPrice: 1000, lastAlertedAt: hoursAgo(48) };
    expect(decideAlert({ ...cfg, targetPrice: 1100 }, s, snap(970), NOW).triggerTypes).toEqual(["deeper_drop"]);
    expect(decideAlert({ ...cfg, targetPrice: 1100 }, s, snap(971), NOW).kind).toBe("no_alert");
  });

  it("cooldown: the new edge is deferred and NOT recorded as true", () => {
    const s = { ...base, condState: { target_price: false }, lastAlertPrice: 990, lastAlertedAt: hoursAgo(3) };
    const d = decideAlert(cfg, s, snap(990), NOW);
    expect(d.kind).toBe("suppressed_cooldown");
    expect(d.nextState?.condState).toEqual({ target_price: false });
    expect(d.nextState?.alerted).toBeUndefined();
  });

  it("cooldown on a condition with no prior state → key removed, not recorded as true", () => {
    const s = { ...base, lastAlertedAt: hoursAgo(3) };
    const d = decideAlert(cfg, s, snap(990), NOW);
    expect(d.nextState?.condState).toEqual({});
  });

  it("drop_pct fires → baseline moves to the alerted price", () => {
    const c = { ...cfg, targetPrice: null, dropPct: 10 };
    const d = decideAlert(c, { ...base, baselinePrice: 1000 }, snap(900), NOW);
    expect(d.triggerTypes).toEqual(["drop_pct"]);
    expect(d.nextState?.baselinePrice).toBe(900);
  });

  it("null baseline + a price → sets the baseline, no alert", () => {
    const c = { ...cfg, targetPrice: null, dropPct: 10 };
    const d = decideAlert(c, { ...base, baselinePrice: null }, snap(900), NOW);
    expect(d.kind).toBe("no_alert");
    expect(d.nextState?.baselinePrice).toBe(900);
  });

  it("unknown does not overwrite the old condState", () => {
    const c = { ...cfg, targetPrice: null, notifyLow: true };
    const s = { ...base, condState: { low: true } };
    const d = decideAlert(c, s, snap(900, { deal: null }), NOW);
    expect(d.nextState?.condState).toEqual({ low: true });
  });
});
