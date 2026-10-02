import { describe, expect, it } from "vitest";
import { isPendingDemand, planSourcing, sourcingCap, type SourcingQuery } from "@/lib/sourcing/plan";

const q = (id: string, over: Partial<SourcingQuery> = {}): SourcingQuery => ({
  id,
  marketplace: "shopee",
  kind: "keyword",
  value: id,
  active: true,
  nextPage: null,
  lastRunAt: null,
  origin: "seed",
  requestCount: 0,
  lastRequestedAt: null,
  ...over,
});

describe("planSourcing", () => {
  it("active only; never-run first, then oldest first", () => {
    const plan = planSourcing([
      q("new"),
      q("old", { lastRunAt: "2026-09-01T00:00:00Z" }),
      q("off", { active: false }),
      q("recent", { lastRunAt: "2026-09-30T00:00:00Z" }),
    ]);
    expect(plan.map((x) => x.id)).toEqual(["new", "old", "recent"]);
  });
});

describe("sourcingCap", () => {
  it("defaults to 500; 0 disables; junk → default", () => {
    expect(sourcingCap({})).toBe(500);
    expect(sourcingCap({ SOURCING_DAILY_CAP: "0" })).toBe(0);
    expect(sourcingCap({ SOURCING_DAILY_CAP: "120" })).toBe(120);
    expect(sourcingCap({ SOURCING_DAILY_CAP: "abc" })).toBe(500);
  });
});

describe("planSourcing modes", () => {
  const demand = (id: string, over: Partial<SourcingQuery> = {}) =>
    q(id, { origin: "demand", requestCount: 1, lastRequestedAt: "2026-10-01T05:00:00Z", ...over });

  it("pending demand = demand never run, or requested after its last run", () => {
    expect(isPendingDemand(demand("a"))).toBe(true);
    expect(isPendingDemand(demand("b", { lastRunAt: "2026-10-01T06:00:00Z" }))).toBe(false);
    expect(isPendingDemand(demand("c", { lastRunAt: "2026-10-01T04:00:00Z" }))).toBe(true);
    expect(isPendingDemand(q("seed"))).toBe(false);
  });

  it("mode 'all' puts pending demand first, by request count", () => {
    const plan = planSourcing([q("seed1"), demand("d1", { requestCount: 2 }), demand("d2", { requestCount: 9 })]);
    expect(plan.map((x) => x.id)).toEqual(["d2", "d1", "seed1"]);
  });

  it("mode 'demand' returns only pending demand, at most 5", () => {
    const many = Array.from({ length: 7 }, (_, i) => demand(`d${i}`, { requestCount: i }));
    const plan = planSourcing([q("seed1"), demand("done", { lastRunAt: "2026-10-02T00:00:00Z" }), ...many], { mode: "demand" });
    expect(plan.map((x) => x.id)).toEqual(["d6", "d5", "d4", "d3", "d2"]);
  });
});
