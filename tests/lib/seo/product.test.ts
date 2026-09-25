import { describe, expect, it } from "vitest";
import { buildProductJsonLd, productMetadata, productPath, serializeJsonLd, type SeoProduct } from "@/lib/seo/product";

const SITE = "https://kairo.vn";

function product(over: Partial<SeoProduct> = {}): SeoProduct {
  return {
    slug: "samsung-990-pro",
    categorySlug: "ssd",
    canonicalName: "SSD Samsung 990 Pro",
    brand: "Samsung",
    model: "990 Pro",
    image: "/samples/ssd.svg",
    status: "verified",
    variants: [
      { price: 2_500_000, inStock: true },
      { price: 4_000_000, inStock: true },
      { price: 1_900_000, inStock: false },
    ],
    recommendation: "buy",
    ...over,
  };
}

describe("productPath", () => {
  it("is /{category}/{slug}", () => {
    expect(productPath(product())).toBe("/ssd/samsung-990-pro");
  });
});

describe("productMetadata", () => {
  it("has a canonical URL without any query string", () => {
    const m = productMetadata(product(), SITE);
    expect(m.alternates?.canonical).toBe(`${SITE}/ssd/samsung-990-pro`);
  });

  it("puts the lowest in-stock price and the verdict in the description", () => {
    const m = productMetadata(product(), SITE);
    expect(m.title).toContain("SSD Samsung 990 Pro");
    expect(m.description).toContain("2.500.000");
    expect(m.description).toContain("Nên mua");
    expect(m.description).not.toContain("1.900.000"); // out of stock
  });

  it("does not invent a price when nothing is in stock", () => {
    const m = productMetadata(product({ variants: [{ price: 100, inStock: false }] }), SITE);
    expect(m.description).not.toMatch(/\d\.\d{3}/);
  });

  it("marks draft products noindex", () => {
    expect(productMetadata(product({ status: "draft" }), SITE).robots).toEqual({ index: false, follow: true });
    expect(productMetadata(product(), SITE).robots).toBeUndefined();
  });

  it("sets Open Graph url and absolute image", () => {
    const og = productMetadata(product(), SITE).openGraph as { url: string; images?: unknown };
    expect(og.url).toBe(`${SITE}/ssd/samsung-990-pro`);
  });
});

describe("buildProductJsonLd", () => {
  it("builds Product + AggregateOffer from in-stock variants", () => {
    const ld = buildProductJsonLd(product(), SITE)!;
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "SSD Samsung 990 Pro",
      brand: { "@type": "Brand", name: "Samsung" },
      image: `${SITE}/samples/ssd.svg`,
      url: `${SITE}/ssd/samsung-990-pro`,
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "VND",
        lowPrice: 2_500_000,
        highPrice: 4_000_000,
        offerCount: 2,
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("has no offers when no variant has an in-stock price", () => {
    const ld = buildProductJsonLd(product({ variants: [{ price: null, inStock: true }] }), SITE)!;
    expect(ld.offers).toBeUndefined();
  });

  it("returns null for draft products", () => {
    expect(buildProductJsonLd(product({ status: "draft" }), SITE)).toBeNull();
  });

  it("never claims a rating", () => {
    expect(buildProductJsonLd(product(), SITE)).not.toHaveProperty("aggregateRating");
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so a product name cannot close the script tag", () => {
    const s = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(s).not.toContain("<");
    expect(JSON.parse(s).name).toBe("</script><script>alert(1)</script>");
  });
});
