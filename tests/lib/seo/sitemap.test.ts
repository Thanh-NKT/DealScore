import { describe, expect, it } from "vitest";
import { brandSlug, buildSitemap, resolveBrandSlug } from "@/lib/seo/sitemap";

const SITE = "https://kairo.vn";

describe("buildSitemap", () => {
  const entries = buildSitemap(
    {
      products: [{ slug: "samsung-990-pro", categorySlug: "ssd", updatedAt: "2026-09-20T10:00:00Z" }],
      categories: [{ slug: "ssd" }],
      brands: ["Samsung", "Western Digital"],
    },
    SITE,
  );
  const urls = entries.map((e) => e.url);

  it("lists home, categories, brands and products with absolute URLs", () => {
    expect(urls).toEqual([
      `${SITE}/`,
      `${SITE}/ssd`,
      `${SITE}/brand/samsung`,
      `${SITE}/brand/western-digital`,
      `${SITE}/ssd/samsung-990-pro`,
    ]);
  });

  it("uses the product's last price update as lastModified", () => {
    expect(entries.at(-1)?.lastModified).toEqual(new Date("2026-09-20T10:00:00Z"));
  });

  it("never lists /search (result pages are not canonical)", () => {
    expect(urls.some((u) => u.includes("/search"))).toBe(false);
  });
});

describe("brand slugs", () => {
  it("slugify the brand name", () => {
    expect(brandSlug("Western Digital")).toBe("western-digital");
  });
  it("resolve back to the stored brand name", () => {
    expect(resolveBrandSlug("western-digital", ["Samsung", "Western Digital"])).toBe("Western Digital");
    expect(resolveBrandSlug("nope", ["Samsung"])).toBeNull();
  });
});
