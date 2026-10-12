import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getFilterFacets, searchProducts, type SearchResult } from "@/lib/search";
import { CatalogListing } from "@/components/search/catalog-listing";
import { siteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";
import { categorySeasonView, type CategorySeasonRow } from "@/lib/seasons/category";
import { CategorySeasonStrip } from "@/components/product/season-calendar";
import type { SeasonEventKey } from "@/lib/seasons/events";

/** One read of category_season_stats (P4 A). A failure hides the strip; it never fails the page. */
async function loadCategorySeason(slug: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_season_stats")
      .select("event_key, variants_counted, occurrences, median_ratio, share_lower, categories!inner(slug)")
      .eq("categories.slug", slug);
    if (error) throw new Error(error.message);
    const rows: CategorySeasonRow[] = (data ?? []).map((r) => ({
      key: r.event_key as SeasonEventKey,
      variantsCounted: r.variants_counted,
      occurrences: r.occurrences,
      medianRatio: Number(r.median_ratio),
      shareLower: Number(r.share_lower),
    }));
    return categorySeasonView(rows);
  } catch (err) {
    console.error("category page: season stats failed", err);
    return null;
  }
}

interface PageProps {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ page?: string }>;
}

export const dynamic = "force-dynamic";

const getCategory = cache(async (slug: string) => {
  const { categories } = await getFilterFacets();
  return categories.find((c) => c.slug === slug) ?? null;
});

function pageNumber(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { category } = await params;
  const page = pageNumber((await searchParams).page);
  const cat = await getCategory(category);
  if (!cat) return {};
  const path = page > 1 ? `/${cat.slug}?page=${page}` : `/${cat.slug}`;
  return {
    title: `${cat.name} — giá hôm nay, lịch sử giá & Deal Score | DealScore`,
    description: `So sánh giá ${cat.name} giữa các nơi bán theo từng phiên bản: lịch sử giá, Deal Score có giải thích và báo khi giảm giá.`,
    alternates: { canonical: `${siteUrl()}${path}` },
  };
}

/** Category landing page (1.7): /{category}, e.g. /ssd. Unknown slug → 404. */
export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { category } = await params;
  const page = pageNumber((await searchParams).page);
  const cat = await getCategory(category);
  if (!cat) notFound();

  const seasonView = await loadCategorySeason(cat.slug);
  let result: SearchResult = { items: [], total: 0, page, pageSize: 24 };
  let loadError = false;
  try {
    result = await searchProducts({ categorySlug: cat.slug, sort: "updated", page });
  } catch (err) {
    console.error("category page: searchProducts failed", err);
    loadError = true;
  }

  return (
    <CatalogListing
      title={cat.name}
      result={result}
      basePath={`/${cat.slug}`}
      searchHref={`/search?cat=${encodeURIComponent(cat.slug)}`}
      loadError={loadError}
      aside={<CategorySeasonStrip name={cat.name} view={seasonView} />}
    />
  );
}
