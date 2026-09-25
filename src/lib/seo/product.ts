/**
 * SEO for the product page (1.7): metadata, canonical URL and schema.org JSON-LD. Pure.
 *
 * The canonical URL never carries ?variant= / ?range=: those only change what is highlighted,
 * and indexing each combination would split the page's ranking.
 */
import type { Metadata } from "next";
import { formatVnd } from "@/lib/format";
import type { Recommendation } from "@/lib/pricing/deal-score";
import type { ProductPageData } from "@/lib/product/page-data";

export interface SeoProduct {
  slug: string;
  categorySlug: string;
  canonicalName: string;
  brand: string | null;
  model: string | null;
  image: string | null;
  status: "draft" | "verified";
  variants: Array<{ price: number | null; inStock: boolean }>;
  /** Headline recommendation of the default variant, null when there is no price at all. */
  recommendation: Recommendation | null;
}

const VERDICT: Record<Recommendation, string> = {
  buy: "Nên mua",
  wait: "Có thể chờ",
  avoid: "Chưa nên mua",
  insufficient_data: "Chưa đủ dữ liệu để kết luận",
};

export function productPath(p: Pick<SeoProduct, "slug" | "categorySlug">): string {
  return `/${p.categorySlug}/${p.slug}`;
}

function absolute(siteUrl: string, pathOrUrl: string): string {
  return /^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${siteUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

function inStockPrices(p: SeoProduct): number[] {
  return p.variants
    .filter((v) => v.inStock && v.price != null && v.price > 0)
    .map((v) => v.price as number);
}

export function productMetadata(p: SeoProduct, siteUrl: string): Metadata {
  const url = absolute(siteUrl, productPath(p));
  const prices = inStockPrices(p);
  const low = prices.length > 0 ? Math.min(...prices) : null;

  const parts = [
    low != null ? `Giá thấp nhất hôm nay ${formatVnd(low)}` : "Chưa có giá còn hàng",
    p.recommendation ? VERDICT[p.recommendation] : null,
    "Lịch sử giá 90 ngày, Deal Score có giải thích và báo khi giảm giá.",
  ].filter(Boolean);

  const title = `${p.canonicalName} — giá hôm nay & lịch sử giá | Kairo`;
  const description = `${p.canonicalName}: ${parts.join(". ")}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title,
      description,
      siteName: "Kairo",
      locale: "vi_VN",
    },
    // Draft = auto-created from a pasted URL, not reviewed: keep it out of the index, but let
    // crawlers follow its links.
    ...(p.status === "draft" ? { robots: { index: false, follow: true } } : {}),
  };
}

export function buildProductJsonLd(p: SeoProduct, siteUrl: string): Record<string, unknown> | null {
  if (p.status === "draft") return null;

  const prices = inStockPrices(p);
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.canonicalName,
    url: absolute(siteUrl, productPath(p)),
  };
  if (p.brand) ld.brand = { "@type": "Brand", name: p.brand };
  if (p.model) ld.model = p.model;
  if (p.image) ld.image = absolute(siteUrl, p.image);
  if (prices.length > 0) {
    ld.offers = {
      "@type": "AggregateOffer",
      priceCurrency: "VND",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      offerCount: prices.length,
      availability: "https://schema.org/InStock",
    };
  }
  // No aggregateRating / review: we have no real rating data, and inventing one is a
  // structured-data policy violation.
  return ld;
}

/** JSON for a <script type="application/ld+json">, with "<" escaped so data cannot close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

export function toSeoProduct(data: ProductPageData): SeoProduct {
  const headline = data.pricing.headline;
  return {
    slug: data.product.slug,
    categorySlug: data.product.categorySlug,
    canonicalName: data.product.canonicalName,
    brand: data.product.brand,
    model: data.product.model,
    image: data.product.image,
    status: data.product.status,
    variants: data.variants.map((v) => ({ price: v.price, inStock: v.inStock })),
    recommendation: headline ? (headline.score != null ? headline.recommendation : "insufficient_data") : null,
  };
}
