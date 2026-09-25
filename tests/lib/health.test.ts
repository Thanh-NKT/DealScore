import { describe, expect, it } from "vitest";
import { assessHealth } from "@/lib/health";

const now = new Date("2026-09-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

describe("assessHealth", () => {
  it("is down when the DB is unreachable", () => {
    expect(assessHealth({ dbOk: false, collectorConfigured: true, lastRunFinishedAt: hoursAgo(1), now }).status).toBe("down");
  });

  it("is ok when the collector is not configured yet (nothing to be late)", () => {
    const h = assessHealth({ dbOk: true, collectorConfigured: false, lastRunFinishedAt: null, now });
    expect(h.status).toBe("ok");
    expect(h.checks.collector).toBe("not_configured");
  });

  it("is degraded when the last finished run is older than 6 hours", () => {
    expect(assessHealth({ dbOk: true, collectorConfigured: true, lastRunFinishedAt: hoursAgo(7), now }).status).toBe("degraded");
    expect(assessHealth({ dbOk: true, collectorConfigured: true, lastRunFinishedAt: null, now }).status).toBe("degraded");
  });

  it("is ok with a recent run", () => {
    const h = assessHealth({ dbOk: true, collectorConfigured: true, lastRunFinishedAt: hoursAgo(1), now });
    expect(h).toEqual({ status: "ok", checks: { db: "ok", collector: "ok" } });
  });
});
