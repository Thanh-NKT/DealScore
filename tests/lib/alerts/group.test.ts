import { describe, expect, it } from "vitest";
import { groupDeliveries, latestPerWatch, nextRetryAt, type ClaimedDelivery } from "@/lib/alerts/group";

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

describe("latestPerWatch", () => {
  const row = (id: string, watchId: string, channel: "email" | "push" = "email", userId = "u"): ClaimedDelivery => ({
    deliveryId: id,
    channel,
    attempts: 0,
    alertEventId: `e${id}`,
    watchId,
    userId,
  });
  const created: Record<string, string> = {
    e1: "2026-09-21T01:00:00Z",
    e2: "2026-09-23T01:00:00Z",
    e3: "2026-09-22T01:00:00Z",
    e4: "2026-09-22T01:00:00Z",
    e5: "2026-09-20T01:00:00Z",
  };
  const at = (id: string) => created[id];

  it("a week of alerts for one Watch → only the newest is kept", () => {
    const r = latestPerWatch([row("1", "w"), row("2", "w"), row("3", "w")], at);
    expect(r).toHaveLength(1);
    expect(r[0].keep.deliveryId).toBe("2");
    expect(r[0].older.map((d) => d.deliveryId)).toEqual(["3", "1"]);
  });

  it("different Watches, channels or users are never merged", () => {
    const r = latestPerWatch([row("1", "w"), row("4", "x"), row("3", "w", "push"), row("5", "w", "email", "v")], at);
    expect(r.map((g) => [g.keep.deliveryId, g.older.length])).toEqual([
      ["1", 0],
      ["4", 0],
      ["3", 0],
      ["5", 0],
    ]);
  });
});
