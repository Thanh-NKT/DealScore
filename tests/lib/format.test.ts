import { describe, expect, it } from "vitest";
import { daysBetween, discountPercent, formatVnd, toVnDate } from "@/lib/format";

/** Intl inserts a non-breaking space before the currency symbol. */
const nbsp = (s: string) => s.replace(/ /g, " ");

describe("formatVnd", () => {
  it("formats Vietnamese-style: dot thousands, đ suffix, no space (DESIGN.md price rule)", () => {
    expect(formatVnd(1_234_000)).toBe("1.234.000đ");
    expect(formatVnd(189_000)).toBe("189.000đ");
    expect(formatVnd(0)).toBe("0đ");
  });

  it("formats large prices without abbreviating", () => {
    expect(formatVnd(1_250_000_000)).toBe("1.250.000.000đ");
  });

  it("rounds to an integer", () => {
    expect(formatVnd(1000.6)).toBe("1.001đ");
  });

  it("returns a dash when there is no value — never shows 0đ", () => {
    expect(formatVnd(null)).toBe("—");
    expect(formatVnd(undefined)).toBe("—");
    expect(formatVnd(Number.NaN)).toBe("—");
  });
});

describe("discountPercent", () => {
  it("computes the discount percentage", () => {
    expect(discountPercent(80, 100)).toBe(20);
  });

  it("rounds DOWN, never rounds a promotion up", () => {
    expect(discountPercent(99, 100)).toBe(1);
  });

  it("returns null when rounding down yields 0 — '−0%' is meaningless", () => {
    expect(discountPercent(999, 1000)).toBeNull();
  });

  it("returns null when there is no discount or it costs more than list", () => {
    expect(discountPercent(100, 100)).toBeNull();
    expect(discountPercent(120, 100)).toBeNull();
  });

  it("returns null when data is missing", () => {
    expect(discountPercent(null, 100)).toBeNull();
    expect(discountPercent(100, null)).toBeNull();
    expect(discountPercent(undefined, undefined)).toBeNull();
  });
});

describe("toVnDate", () => {
  it("uses Vietnam time, not UTC", () => {
    // 17:30Z on the 10th = 00:30 on the 11th in Vietnam time.
    expect(toVnDate("2026-03-10T17:30:00Z")).toBe("2026-03-11");
  });

  it("keeps the date when still within the same Vietnam day", () => {
    expect(toVnDate("2026-03-10T05:00:00Z")).toBe("2026-03-10");
  });
});

describe("daysBetween", () => {
  it("returns a positive day count regardless of order", () => {
    expect(daysBetween("2026-03-10T00:00:00Z", "2026-03-12T00:00:00Z")).toBe(2);
    expect(daysBetween("2026-03-12T00:00:00Z", "2026-03-10T00:00:00Z")).toBe(2);
  });
});
