import { describe, expect, it } from "vitest";
import { groupDeliveries, nextRetryAt, type ClaimedDelivery } from "@/lib/alerts/group";

const d = (id: string, userId: string, channel: "email" | "push"): ClaimedDelivery => ({
  deliveryId: id,
  channel,
  attempts: 0,
  alertEventId: `e${id}`,
  watchId: "w",
  userId,
});

describe("groupDeliveries", () => {
  it("groups by user + channel, preserving order", () => {
    const g = groupDeliveries([d("1", "a", "email"), d("2", "b", "email"), d("3", "a", "push"), d("4", "a", "email")]);
    expect(g.map((x) => [x.userId, x.channel, x.deliveries.map((y) => y.deliveryId)])).toEqual([
      ["a", "email", ["1", "4"]],
      ["b", "email", ["2"]],
      ["a", "push", ["3"]],
    ]);
  });
});

describe("nextRetryAt", () => {
  const now = new Date("2026-09-23T00:00:00Z");
  it("5 / 30 / 120 minutes then out of attempts", () => {
    expect(nextRetryAt(1, now)?.toISOString()).toBe("2026-09-23T00:05:00.000Z");
    expect(nextRetryAt(2, now)?.toISOString()).toBe("2026-09-23T00:30:00.000Z");
    expect(nextRetryAt(3, now)).toBeNull();
  });
});
