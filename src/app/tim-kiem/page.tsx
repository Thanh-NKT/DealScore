import Link from "next/link";
import {
  parseSearchParams,
  searchProducts,
  toSearchParams,
} from "@/lib/search";
import { SearchBox } from "@/components/search/search-box";
import {
  Filters,
  ActiveFilterChips,
  SortSelect,
} from "@/components/search/filters";
import { ProductCard } from "@/components/search/product-card";
import { EmptyState } from "@/components/search/empty-state";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const rawParams = await searchParams;
  const params = parseSearchParams(rawParams);
  const result = await searchProducts(params);

  const totalPages = Math.ceil(result.total / result.pageSize);
  const currentPage = result.page;

  const hasFilters =
    Boolean(params.categorySlug) ||
    Boolean(params.brands && params.brands.length > 0) ||
    params.minPrice != null ||
    params.maxPrice != null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:py-12 space-y-8">
      {/* Ô tìm kiếm đầu trang */}
      <div className="mx-auto max-w-3xl">
        <SearchBox initialQuery={params.q} />
      </div>

      {/* Chip bộ lọc đang bật */}
      <ActiveFilterChips params={params} />

      <div className="flex flex-col md:flex-row gap-8 items-start">
        {/* Cột bộ lọc trái */}
        <Filters params={params} />

        {/* Cột nội dung kết quả */}
        <div className="flex-1 w-full space-y-6">
          {/* Header kết quả + Sort */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
            <div className="text-xs text-muted">
              {params.q ? (
                <span>
                  Kết quả cho <strong>&ldquo;{params.q}&rdquo;</strong>:{" "}
                  <strong>{result.total}</strong> sản phẩm
                </span>
              ) : (
                <span>
                  Tổng cộng: <strong>{result.total}</strong> sản phẩm
                </span>
              )}
              {params.sort === "deal_score" && (
                <span className="ml-2 text-[11px] text-muted italic">
                  (Điểm cập nhật theo collector gần nhất)
                </span>
              )}
            </div>

            <SortSelect currentSort={params.sort} />
          </div>

          {/* Danh sách sản phẩm */}
          {result.items.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {result.items.map((item) => (
                <ProductCard key={item.productId} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState query={params.q} hasFilters={hasFilters} />
          )}

          {/* Phân trang bằng Link (Server Component) */}
          {totalPages > 1 && (
            <nav
              aria-label="Phân trang"
              className="flex items-center justify-center gap-2 pt-6 border-t border-border"
            >
              {currentPage > 1 && (
                <Link
                  href={`/tim-kiem?${toSearchParams({
                    ...params,
                    page: currentPage - 1,
                  }).toString()}`}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
                >
                  ← Trang trước
                </Link>
              )}

              <span className="text-xs text-muted px-2">
                Trang {currentPage} / {totalPages}
              </span>

              {currentPage < totalPages && (
                <Link
                  href={`/tim-kiem?${toSearchParams({
                    ...params,
                    page: currentPage + 1,
                  }).toString()}`}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:hover:bg-white/5"
                >
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
