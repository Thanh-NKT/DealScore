import { describe, expect, it } from "vitest";
import { extractPriceRange, parsePriceAmount } from "@/lib/intent/price";

describe("parsePriceAmount", () => {
  it.each([
    ["3tr", 3_000_000], ["3tr5", 3_500_000], ["3 trieu", 3_000_000], ["1,5trieu", 1_500_000],
    ["1.5tr", 1_500_000], ["500k", 500_000], ["500 nghin", 500_000], ["200 ngan", 200_000],
    ["2m", 2_000_000], ["3.000.000d", 3_000_000], ["3,000,000 vnd", 3_000_000], ["3000000", 3_000_000],
    ["3.000.000", 3_000_000],
  ])("%s → %d", (t, v) => expect(parsePriceAmount(t)).toBe(v));
  it.each(["990", "27", "2tb", "abc", "0k", "5000tr"])("%s → null", (t) => expect(parsePriceAmount(t)).toBeNull());
});

const range = (s: string) => {
  const r = extractPriceRange(s);
  return r && { minPrice: r.minPrice, maxPrice: r.maxPrice };
};

describe("extractPriceRange", () => {
  it("max phrases", () => {
    expect(range("ssd 2tb duoi 3 trieu")).toEqual({ minPrice: undefined, maxPrice: 3_000_000 });
    expect(range("ssd < 3tr")).toEqual({ minPrice: undefined, maxPrice: 3_000_000 });
    expect(range("toi da 3tr5")).toEqual({ minPrice: undefined, maxPrice: 3_500_000 });
    expect(range("khong qua 500k")).toEqual({ minPrice: undefined, maxPrice: 500_000 });
  });
  it("min phrases", () => {
    expect(range("tren 2 trieu")).toEqual({ minPrice: 2_000_000, maxPrice: undefined });
    expect(range("tu 2tr tro len")).toEqual({ minPrice: 2_000_000, maxPrice: undefined });
    expect(range("it nhat 1tr")).toEqual({ minPrice: 1_000_000, maxPrice: undefined });
  });
  it("between", () => {
    expect(range("tu 3 den 5 trieu")).toEqual({ minPrice: 3_000_000, maxPrice: 5_000_000 });
    expect(range("tu 1tr toi 2tr")).toEqual({ minPrice: 1_000_000, maxPrice: 2_000_000 });
    expect(range("1tr - 2tr")).toEqual({ minPrice: 1_000_000, maxPrice: 2_000_000 });
  });
  it("around = ±15% rounded to thousands", () => {
    expect(range("tam 1 trieu")).toEqual({ minPrice: 850_000, maxPrice: 1_150_000 });
    expect(range("khoang 2tr")).toEqual({ minPrice: 1_700_000, maxPrice: 2_300_000 });
    expect(range("~500k")).toEqual({ minPrice: 425_000, maxPrice: 575_000 });
  });
  it("bare amount with unit counts as max only after a price cue; bare numbers never", () => {
    expect(range("samsung 990 pro")).toBeNull();
    expect(range("man hinh 27 inch")).toBeNull();
    expect(range("ssd 2tb")).toBeNull();
  });
  it("returns the span of the phrase", () => {
    const s = "ssd duoi 3tr 2tb";
    const r = extractPriceRange(s)!;
    expect(s.slice(r.start, r.end).trim()).toBe("duoi 3tr");
  });
  it("skips an earlier same-kind match whose amount fails to validate", () => {
    expect(range("toi da 0d roi toi da 500k")).toEqual({ minPrice: undefined, maxPrice: 500_000 });
  });
});
