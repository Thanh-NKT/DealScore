import { describe, expect, it } from "vitest";
import { planSourcing, sourcingCap, type SourcingQuery } from "@/lib/sourcing/plan";

const q = (id: string, over: Partial<SourcingQuery> = {}): SourcingQuery => ({
  id,
  marketplace: "shopee",
  kind: "keyword",
  value: id,
  active: true,
  nextPage: null,
  lastRunAt: null,
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
