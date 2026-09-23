import { describe, expect, it } from "vitest";
import { describeWatch } from "@/lib/watch/describe";
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
  it("khoảng cách tới target và thay đổi từ lúc bắt đầu", () => {
    const v = describeWatch(input());
    expect(v.target).toEqual({ amount: 900, gap: 100, gapPct: 0.1, reached: false });
    expect(v.changeSinceStart).toEqual({ amount: -200, pct: -200 / 1200, since: "2026-09-12T00:00:00Z" });
    expect(v.sortKey).toBeCloseTo(0.1);
  });

  it("đã đạt target → reached, sortKey 0", () => {
    const v = describeWatch(input({ snapshot: snap({ price: 850 }) }));
    expect(v.target?.reached).toBe(true);
    expect(v.sortKey).toBe(0);
  });

  it("hết hàng / stale → sortKey 2; không target → 1", () => {
    expect(describeWatch(input({ snapshot: snap({ inStock: false }) })).sortKey).toBe(2);
    expect(describeWatch(input({ config: { ...config, targetPrice: null, notifyLow: true } })).sortKey).toBe(1);
  });

  it("alertStatus: đã gửi / đang chờ tóm tắt / chưa có", () => {
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
    expect(pending.alertStatus).toEqual({ kind: "scheduled", deliverAfter: "2026-09-24T01:00:00Z", reason: "daily_digest" });
  });

  it("conditions dùng evaluateConditions", () => {
    expect(describeWatch(input()).conditions).toEqual([{ key: "target_price", state: false }]);
  });
});
