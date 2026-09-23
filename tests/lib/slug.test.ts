import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "@/lib/slug";

describe("slugify", () => {
  it("strips Vietnamese diacritics", () => {
    expect(slugify("Ổ cứng SSD Samsung 990 PRO 2TB")).toBe(
      "o-cung-ssd-samsung-990-pro-2tb",
    );
  });

  it("handles Đ/đ — NFD does NOT decompose this letter", () => {
    expect(slugify("Đĩa cứng")).toBe("dia-cung");
    expect(slugify("đèn")).toBe("den");
  });

  it("collapses odd characters and adjacent dashes", () => {
    expect(slugify("A  --  B")).toBe("a-b");
    expect(slugify("Bàn phím (cơ) 100%!")).toBe("ban-phim-co-100");
  });

  it("truncates to maxLength without leaving a trailing dash", () => {
    expect(slugify("aaaa bbbb cccc", 10)).toBe("aaaa-bbbb");
  });

  it("never returns an empty string — an empty slug would break the URL", () => {
    expect(slugify("!!!")).not.toBe("");
    expect(slugify("")).not.toBe("");
  });
});

describe("uniqueSlug", () => {
  it("returns the slug as is when unused", async () => {
    const taken = new Set<string>();
    expect(await uniqueSlug("a", async (s) => taken.has(s))).toBe("a");
  });

  it("appends a suffix until free", async () => {
    const taken = new Set(["a", "a-2"]);
    expect(await uniqueSlug("a", async (s) => taken.has(s))).toBe("a-3");
  });

  it("normalizes the base before checking collisions", async () => {
    const taken = new Set<string>();
    expect(await uniqueSlug("Ổ Cứng", async (s) => taken.has(s))).toBe("o-cung");
  });
});
