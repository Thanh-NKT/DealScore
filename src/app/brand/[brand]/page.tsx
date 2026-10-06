import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getFilterFacets, searchProducts, type SearchResult } from "@/lib/search";
import { brandSlug, resolveBrandSlug } from "@/lib/seo/sitemap";
import { CatalogListing } from "@/components/search/catalog-listing";
import { siteUrl } from "@/lib/site-url";

interface PageProps {
  params: Promise<{ brand: string }>;
  searchParams: Promise<{ page?: string }>;
}

export const dynamic = "force-dynamic";

const getBrand = cache(async (slug: string) => {
  const { brands } = await getFilterFacets();
  return resolveBrandSlug(slug, brands);
});

function pageNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { brand } = await params;
  const page = pageNumber((await searchParams).page);
  const name = await getBrand(brand);
  if (!name) return {};
  const path = `/brand/${brandSlug(name)}${page > 1 ? `?page=${page}` : ""}`;
  return {
    title: `${name} — giá hôm nay, lịch sử giá & Deal Score | DealScore`,
    description: `Giá sản phẩm ${name} trên Shopee: lịch sử giá theo phiên bản, Deal Score có giải thích và báo khi giảm giá.`,
    alternates: { canonical: `${siteUrl()}${path}` },
  };
}

/** Brand landing page (1.7): /brand/{slugified brand}. Unknown slug → 404. */
export default async function BrandPage({ params, searchParams }: PageProps) {
  const { brand } = await params;
  const page = pageNumber((await searchParams).page);
  const name = await getBrand(brand);
  if (!name) notFound();

  let result: SearchResult = { items: [], total: 0, page, pageSize: 24 };
  let loadError = false;
  try {
    result = await searchProducts({ brands: [name], sort: "updated", page });
  } catch (err) {
    console.error("brand page: searchProducts failed", err);
    loadError = true;
  }

  return (
    <CatalogListing
      title={`Thương hiệu ${name}`}
      result={result}
      basePath={`/brand/${brandSlug(name)}`}
      searchHref={`/search?brand=${encodeURIComponent(name)}`}
      loadError={loadError}
    />
  );
}
