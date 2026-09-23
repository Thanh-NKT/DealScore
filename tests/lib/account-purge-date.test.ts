import { describe, expect, it } from "vitest";
import { purgeCutoff, purgeDate } from "@/lib/account-purge-date";

describe("purgeCutoff / purgeDate", () => {
  it("đúng 30 ngày", () => {
    const now = new Date("2026-10-23T00:00:00Z");
    expect(purgeCutoff(now).toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(purgeDate(new Date("2026-09-23T00:00:00Z")).toISOString()).toBe("2026-10-23T00:00:00.000Z");
  });
});
