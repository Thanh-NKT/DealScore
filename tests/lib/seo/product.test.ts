import { describe, expect, it } from "vitest";
import { buildProductJsonLd, productMetadata, productPath, productRedirectPath, serializeJsonLd, type SeoProduct } from "@/lib/seo/product";

const SITE = "https://dealscore.vn";

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
      { price: 2_500_000, inStock: true, offerCount: 3 },
      { price: 4_000_000, inStock: true, offerCount: 2 },
      { price: 1_900_000, inStock: false, offerCount: 4 },
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

describe("productRedirectPath", () => {
  it("null when the category segment is the product's own", () => {
    expect(productRedirectPath("ssd", product())).toBeNull();
  });

  it("a wrong category segment redirects to the canonical path, keeping the query", () => {
    expect(productRedirectPath("anything", product(), { variant: "v1", range: "7" })).toBe("/ssd/samsung-990-pro?variant=v1&range=7");
    expect(productRedirectPath("anything", product())).toBe("/ssd/samsung-990-pro");
  });

  it("a product without a category lives under the shared san-pham fallback", () => {
    expect(productRedirectPath("san-pham", product({ categorySlug: "san-pham" }))).toBeNull();
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
        offerCount: 5, // offers behind the in-stock prices, not the number of variants
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("omits offerCount when the offer count is unknown", () => {
    const ld = buildProductJsonLd(product({ variants: [{ price: 1_000_000, inStock: true }] }), SITE)!;
    expect(ld.offers).not.toHaveProperty("offerCount");
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
