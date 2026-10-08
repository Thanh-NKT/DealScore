import { describe, expect, it } from "vitest";
import { describeWatch, scheduledText } from "@/lib/watch/describe";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@/lib/account/notification-settings";
import type { VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

const config: WatchConfig = {
  targetPrice: 900,
  dropPct: null,
  notifyLow: false,
  minDealScore: null,
  notifyBackInStock: false,
  channels: null,
};
const state: WatchState = { baselinePrice: 1200, condState: {}, lastAlertPrice: null, lastAlertedAt: null, lastInStock: true };
const snap = (o: Partial<VariantSnapshot> = {}): VariantSnapshot => ({
  variantId: "v",
  price: 1000,
  inStock: true,
  offerId: "o",
  observedAt: "x",
  isStale: false,
  deal: null,
  ...o,
});
const input = (o: Partial<Parameters<typeof describeWatch>[0]> = {}) => ({
  config,
  state,
  snapshot: snap(),
  createdAt: "2026-09-12T00:00:00Z",
  latestAlert: null,
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  ...o,
});

describe("describeWatch", () => {
  it("priceHike only for an active watch (paused / done are not evaluated, the hike state is stale)", () => {
    const hike = { config: { ...config, notifyPriceHike: true }, state: { ...state, hikeActive: true } };
    expect(describeWatch(input(hike)).priceHike).toEqual({ active: true });
    expect(describeWatch(input({ ...hike, status: "active" })).priceHike).toEqual({ active: true });
    expect(describeWatch(input({ ...hike, status: "paused" })).priceHike).toBeNull();
    expect(describeWatch(input({ ...hike, status: "done" })).priceHike).toBeNull();
  });

  it("change7d from snapshot.price7dAgo; changeSinceStart unchanged", () => {
    const v = describeWatch(input({ snapshot: snap({ price: 800, price7dAgo: 1000 }) }));
    expect(v.change7d).toEqual({ amount: -200, pct: -0.2, refPrice: 1000, days: 7 });
    expect(v.changeSinceStart).toEqual({ amount: -400, pct: -400 / 1200, since: "2026-09-12T00:00:00Z" });
    expect(describeWatch(input()).change7d).toBeNull();
    expect(describeWatch(input({ snapshot: snap({ price7dAgo: null }) })).change7d).toBeNull();
  });

  it("distance to target and change since tracking started", () => {
    const v = describeWatch(input());
    expect(v.target).toEqual({ amount: 900, gap: 100, gapPct: 0.1, reached: false });
    expect(v.changeSinceStart).toEqual({ amount: -200, pct: -200 / 1200, since: "2026-09-12T00:00:00Z" });
    expect(v.sortKey).toBeCloseTo(0.1);
  });

  it("target reached → reached, sortKey 0", () => {
    const v = describeWatch(input({ snapshot: snap({ price: 850 }) }));
    expect(v.target?.reached).toBe(true);
    expect(v.sortKey).toBe(0);
  });

  it("out of stock / stale → sortKey 2; no target → 1", () => {
    expect(describeWatch(input({ snapshot: snap({ inStock: false }) })).sortKey).toBe(2);
    expect(describeWatch(input({ config: { ...config, targetPrice: null, notifyLow: true } })).sortKey).toBe(1);
  });

  it("alertStatus: sent / waiting for digest / none", () => {
    expect(describeWatch(input()).alertStatus).toEqual({ kind: "none" });
    const sent = describeWatch(
      input({
        latestAlert: {
          id: "a1",
          createdAt: "t",
          deliverAfter: "t",
          deliveries: [{ channel: "email", status: "sent", sentAt: "2026-09-22T03:15:00Z" }],
        },
      }),
    );
    expect(sent.alertStatus).toEqual({ kind: "sent", at: "2026-09-22T03:15:00Z", channels: ["email"] });
    const pending = describeWatch(
      input({
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, frequency: "daily_digest" },
        latestAlert: { id: "a1", createdAt: "t", deliverAfter: "2026-09-24T01:00:00Z", deliveries: [{ channel: "email", status: "pending", sentAt: null }] },
      }),
    );
    expect(pending.alertStatus).toEqual({
      kind: "scheduled",
      deliverAfter: "2026-09-24T01:00:00Z",
      reason: "daily_digest",
      text: "Sẽ gửi trong bản tóm tắt hằng ngày lúc 08:00",
    });
  });

  it("alertStatus: waiting for the weekly digest names the weekday and hour (Vietnam time)", () => {
    const v = describeWatch(
      input({
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, frequency: "weekly_digest", digestWeekday: 1, digestHour: 8 },
        // 2026-09-28T01:00Z = Monday 08:00 in Vietnam
        latestAlert: { id: "a1", createdAt: "t", deliverAfter: "2026-09-28T01:00:00Z", deliveries: [{ channel: "push", status: "pending", sentAt: null }] },
      }),
    );
    expect(v.alertStatus).toEqual({
      kind: "scheduled",
      deliverAfter: "2026-09-28T01:00:00Z",
      reason: "weekly_digest",
      text: "Sẽ gửi trong bản tóm tắt Thứ Hai lúc 08:00",
    });
  });

  it("alertStatus: instant + pending → held by quiet hours", () => {
    const v = describeWatch(
      input({
        latestAlert: { id: "a1", createdAt: "t", deliverAfter: "2026-09-24T00:00:00Z", deliveries: [{ channel: "email", status: "pending", sentAt: null }] },
      }),
    );
    expect(v.alertStatus).toMatchObject({ reason: "quiet_hours", text: "Sẽ gửi lúc 07:00, khi hết giờ im lặng" });
  });

  it("conditions use evaluateConditions", () => {
    expect(describeWatch(input()).conditions).toEqual([{ key: "target_price", state: false }]);
  });
});

describe("scheduledText", () => {
  it("weekday comes from the Vietnam date (Sunday 23:00 UTC is Monday in Vietnam)", () => {
    expect(scheduledText("weekly_digest", "2026-09-27T23:00:00Z")).toBe("Sẽ gửi trong bản tóm tắt Thứ Hai lúc 06:00");
  });
  it("Sunday is 'Chủ nhật'", () => {
    expect(scheduledText("weekly_digest", "2026-09-27T12:00:00Z")).toBe("Sẽ gửi trong bản tóm tắt Chủ nhật lúc 19:00");
  });
  it("invalid date → generic text", () => {
    expect(scheduledText("daily_digest", "t")).toBe("Sẽ gửi sau");
  });
});
