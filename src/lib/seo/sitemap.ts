/**
 * Sitemap entries (1.7). Pure — src/app/sitemap.ts loads the rows.
 * Only canonical, indexable URLs: verified products, categories, brands. Never /search.
 */
import type { MetadataRoute } from "next";
import { slugify } from "@/lib/slug";

export function brandSlug(brand: string): string {
  return slugify(brand);
}

/** "/brand/western-digital" → the brand name as stored, or null when no brand has that slug. */
export function resolveBrandSlug(slug: string, brands: string[]): string | null {
  return brands.find((b) => brandSlug(b) === slug) ?? null;
}

export function buildSitemap(
  input: {
    products: Array<{ slug: string; categorySlug: string; updatedAt: string | null }>;
    categories: Array<{ slug: string }>;
    brands: string[];
  },
  siteUrl: string,
): MetadataRoute.Sitemap {
  return [
    { url: `${siteUrl}/`, changeFrequency: "daily", priority: 1 },
    ...input.categories.map((c) => ({
      url: `${siteUrl}/${c.slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    ...input.brands.map((b) => ({
      url: `${siteUrl}/brand/${brandSlug(b)}`,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    ...input.products.map((p) => ({
      url: `${siteUrl}/${p.categorySlug}/${p.slug}`,
      ...(p.updatedAt ? { lastModified: new Date(p.updatedAt) } : {}),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
