import { describe, expect, it } from "vitest";
import { exportFileName } from "@/lib/account-export";

// Test đầy đủ cho buildAccountExport đi cùng schema cuối (Plan 2 Task 14, Plan 3 Task 8).
describe("exportFileName", () => {
  it("theo ngày VN", () => {
    // 20:00Z ngày 23 = 03:00 VN ngày 24
    expect(exportFileName(new Date("2026-09-23T20:00:00Z"))).toBe("kairo-du-lieu-2026-09-24.json");
  });
});
