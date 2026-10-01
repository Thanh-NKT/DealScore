import { describe, expect, it } from "vitest";
import { errorRate, overdueRatio, selectDueListings, type CollectorListing } from "@/lib/collector/schedule";

const now = new Date("2026-09-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

function listing(over: Partial<CollectorListing> = {}): CollectorListing {
  return { id: "l", marketplace: "shopee", externalItemId: "1_2", refreshPriority: 3, lastObservedAt: hoursAgo(1), lastAttemptAt: null, watched: false, ...over };
}

describe("overdueRatio", () => {
  it("is age / interval for the listing's priority", () => {
    expect(overdueRatio(listing({ refreshPriority: 3, lastObservedAt: hoursAgo(12) }), now)).toBeCloseTo(0.5);
    expect(overdueRatio(listing({ refreshPriority: 2, lastObservedAt: hoursAgo(12) }), now)).toBeCloseTo(2);
    expect(overdueRatio(listing({ refreshPriority: 1, lastObservedAt: hoursAgo(1) }), now)).toBeCloseTo(0.5);
  });

  it("uses the priority-1 interval for watched listings", () => {
    expect(overdueRatio(listing({ refreshPriority: 3, lastObservedAt: hoursAgo(4), watched: true }), now)).toBeCloseTo(2);
  });

  it("is Infinity for a listing never observed", () => {
    expect(overdueRatio(listing({ lastObservedAt: null }), now)).toBe(Infinity);
  });

  it("counts age from the later of the last observation and the last failed attempt", () => {
    const l = listing({ refreshPriority: 3, lastObservedAt: hoursAgo(48), lastAttemptAt: hoursAgo(1) });
    expect(overdueRatio(l, now)).toBeLessThan(1);
    expect(selectDueListings([l], now, 10)).toEqual([]);
  });

  it("treats unknown priorities as the slowest interval", () => {
    expect(overdueRatio(listing({ refreshPriority: 9, lastObservedAt: hoursAgo(24) }), now)).toBeCloseTo(1);
  });
});

describe("selectDueListings", () => {
  it("keeps only due listings (ratio ≥ 1), most overdue first, up to the limit", () => {
    const ls = [
      listing({ id: "fresh", lastObservedAt: hoursAgo(1) }),
      listing({ id: "due", lastObservedAt: hoursAgo(30) }),
      listing({ id: "never", lastObservedAt: null }),
      listing({ id: "very", lastObservedAt: hoursAgo(100) }),
    ];
    expect(selectDueListings(ls, now, 10).map((l) => l.id)).toEqual(["never", "very", "due"]);
    expect(selectDueListings(ls, now, 2).map((l) => l.id)).toEqual(["never", "very"]);
  });
});

describe("errorRate", () => {
  it("is failed / total, 0 when nothing ran", () => {
    expect(errorRate(0, 0)).toBe(0);
    expect(errorRate(95, 5)).toBeCloseTo(0.05);
  });
});
