import { describe, expect, it } from "vitest";
// Classic content script with a CommonJS export for tests.
import panel from "../../../extension/src/panel-format.js";

const { relativeVi, coverageText } = panel as {
  relativeVi: (iso: string | null, nowMs: number) => string | null;
  coverageText: (days: number, minDays: number) => string;
};

const NOW = Date.parse("2026-10-07T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeVi", () => {
  it("buckets", () => {
    expect(relativeVi(ago(59_000), NOW)).toBe("vừa xong");
    expect(relativeVi(ago(59 * 60_000), NOW)).toBe("59 phút trước");
    expect(relativeVi(ago(23 * 3_600_000), NOW)).toBe("23 giờ trước");
    expect(relativeVi(ago(3 * 86_400_000), NOW)).toBe("3 ngày trước");
  });
  it("null / bad input → null", () => {
    expect(relativeVi(null, NOW)).toBeNull();
    expect(relativeVi("not a date", NOW)).toBeNull();
  });
});

describe("coverageText", () => {
  it("names the days so far", () => expect(coverageText(6, 14)).toBe("Mới ghi nhận 6/14 ngày"));
});
