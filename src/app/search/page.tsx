import Link from "next/link";
import {
  getFilterFacets,
  parseSearchParams,
  searchProducts,
  toSearchParams,
  type SearchParams,
  NO_ADVANCED_FILTERS,
} from "@/lib/search";
import { SearchBox } from "@/components/search/search-box";
import { Filters, ActiveFilterChips } from "@/components/search/filters";
import { SortSelect } from "@/components/search/sort-select";
import { ProductCard } from "@/components/search/product-card";
import { EmptyState } from "@/components/search/empty-state";
import { getCurrentUser } from "@/lib/auth/session";
import { trackAfter } from "@/lib/analytics/track";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

const PAGE_LINK =
  "inline-flex min-h-11 items-center rounded-md border border-line-strong bg-surface px-4 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2";

function hasFilterParams(params: SearchParams): boolean {
  return (
    Boolean(params.categorySlug) ||
    Boolean(params.brands && params.brands.length > 0) ||
    params.minPrice != null ||
    params.maxPrice != null ||
    params.minRating != null ||
    Boolean(params.freeShipping) ||
    Boolean(params.hasVoucher) ||
    Boolean(params.marketplaces && params.marketplaces.length > 0)
  );
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawParams = await searchParams;
  const params = parseSearchParams(rawParams);
  // A failed search must not take the whole page down: show a "retry" state instead. Facets only
  // feed the filter column, so they degrade to empty lists.
  const [searchRes, facetsRes] = await Promise.allSettled([searchProducts(params), getFilterFacets()]);
  if (searchRes.status === "rejected") console.error("search: searchProducts failed", searchRes.reason);
  if (facetsRes.status === "rejected") console.error("search: getFilterFacets failed", facetsRes.reason);
  const loadError = searchRes.status === "rejected";
  const result =
    searchRes.status === "fulfilled" ? searchRes.value : { items: [], total: 0, page: params.page ?? 1, pageSize: 24 };
  const facets = facetsRes.status === "fulfilled" ? facetsRes.value : { categories: [], brands: [], advanced: NO_ADVANCED_FILTERS, marketplaces: [] };

  if (!loadError) {
    const user = await getCurrentUser().catch(() => null);
    trackAfter("search_performed", {
      userId: user?.id ?? null,
      props: {
        has_query: Boolean(params.q),
        has_filters: hasFilterParams(params),
        result_count: result.total,
        page: result.page,
        sort: params.sort,
      },
    });
  }

  const totalPages = Math.ceil(result.total / result.pageSize);
  const currentPage = result.page;
  const categoryNames = Object.fromEntries(facets.categories.map((c) => [c.slug, c.name]));

  const hasFilters = hasFilterParams(params);
  const pageHref = (page: number) => `/search?${toSearchParams({ ...params, page }).toString()}`;

  return (
    <main className="flex-1">
      {/* Search band: white strip under the header with the box and quick category pills. */}
      <section aria-label="Tìm kiếm" className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-[1440px] space-y-3.5 px-4 py-5 sm:px-6 lg:px-14">
          <div className="max-w-[820px]">
            <SearchBox initialQuery={params.q} />
          </div>
          <ActiveFilterChips params={params} categories={facets.categories} />
        </div>
      </section>

      <div className="mx-auto grid w-full max-w-[1440px] items-start gap-7 px-4 py-8 sm:px-6 lg:px-14 md:grid-cols-[248px_minmax(0,1fr)] lg:grid-cols-[264px_minmax(0,1fr)]">
        <Filters
          params={params}
          availableCategories={facets.categories}
          availableBrands={facets.brands}
          advanced={facets.advanced}
          availableMarketplaces={facets.marketplaces}
        />

        <div className="min-w-0 space-y-6">
          {/* Results header + sort */}
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="min-w-0 space-y-1">
              <h1 className="display text-h2-sm font-bold leading-tight tracking-tight text-ink max-sm:text-h3">
                {loadError ? (
                  "Kết quả tìm kiếm"
                ) : (
                  <>
                    <span className="num text-gradient-warm font-extrabold">{result.total}</span>{" "}
                    <span>sản phẩm{params.q || hasFilters ? " phù hợp" : ""}</span>
                  </>
                )}
              </h1>
              <p className="text-body-sm text-ink-2">
                {params.q ? (
                  <>
                    Kết quả cho <strong className="font-bold text-primary">&ldquo;{params.q}&rdquo;</strong> · Mỗi thẻ đã gom các nơi bán cùng một mẫu
                  </>
                ) : (
                  "Mỗi thẻ đã gom các nơi bán cùng một mẫu sản phẩm"
                )}
              </p>
            </div>

            <SortSelect
              params={params}
              baseQuery={toSearchParams({ ...params, sort: undefined, page: 1 }).toString()}
            />
          </div>

          {/* Product list */}
          {result.items.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
              {result.items.map((item) => (
                <ProductCard
                  key={item.productId}
                  item={item}
                  categoryName={categoryNames[item.categorySlug]}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              kind={
                loadError
                  ? "load_error"
                  : // Past page 1 with no rows: the RPC reports total 0 there, so decide by page number.
                    currentPage > 1
                    ? "page_out_of_range"
                    : hasFilters
                      ? "too_strict"
                      : "no_results"
              }
              query={params.q}
              clearFiltersHref={params.q ? `/search?q=${encodeURIComponent(params.q)}` : "/search"}
              firstPageHref={pageHref(1)}
              retryHref={`/search?${toSearchParams(params).toString()}`}
            />
          )}

          {/* Pagination via Link (Server Component) */}
          {totalPages > 1 && (
            <nav aria-label="Phân trang" className="flex items-center justify-center gap-3 border-t border-line pt-6">
              {currentPage > 1 && (
                <Link href={pageHref(currentPage - 1)} className={PAGE_LINK}>
                  ← Trang trước
                </Link>
              )}
              <span className="px-1 text-body-sm text-ink-3">
                Trang <span className="num font-semibold text-ink">{currentPage}</span> / <span className="num">{totalPages}</span>
              </span>
              {currentPage < totalPages && (
                <Link href={pageHref(currentPage + 1)} className={PAGE_LINK}>
                  Trang sau →
                </Link>
              )}
            </nav>
          )}
        </div>
      </div>
    </main>
  );
}
