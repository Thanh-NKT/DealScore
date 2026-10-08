import Link from "next/link";
import type { ReactNode } from "react";
import type { SearchResult } from "@/lib/search";
import { ProductCard } from "@/components/search/product-card";
import { EmptyState } from "@/components/search/empty-state";

interface CatalogListingProps {
  title: string;
  result: SearchResult;
  /** Page path without query, e.g. "/ssd" or "/brand/samsung". */
  basePath: string;
  /** Same listing on /search, where the full filters live. */
  searchHref: string;
  loadError: boolean;
  /** Rendered under the heading (category season strip, P4 A). */
  aside?: ReactNode;
}

const PAGE_LINK =
  "inline-flex min-h-11 items-center rounded-md border border-line-strong bg-surface px-4 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2";

/**
 * SSR listing for the SEO landing pages (/{category}, /brand/{brand}), 1.7. Same cards and
 * pagination as /search; works without JavaScript.
 */
export function CatalogListing({ title, result, basePath, searchHref, loadError, aside }: CatalogListingProps) {
  const totalPages = Math.ceil(result.total / result.pageSize);
  const page = result.page;
  const pageHref = (n: number) => (n <= 1 ? basePath : `${basePath}?page=${n}`);

  return (
    <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-8 px-4 py-8 sm:px-6 sm:py-12 lg:px-14">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1.5">
          <h1 className="display text-h1 leading-[1.1] font-extrabold text-balance text-ink max-sm:text-h1-sm">{title}</h1>
          <p className="text-body-sm text-ink-3">
            <span className="num font-semibold text-ink-2">{result.total}</span> sản phẩm, giá theo dõi hằng ngày
          </p>
        </div>
        <Link
          href={searchHref}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-4 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2"
        >
          Lọc theo giá, sắp xếp
          <span aria-hidden="true">→</span>
        </Link>
      </header>
      {aside}

      {result.items.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
          {result.items.map((item) => (
            <ProductCard key={item.productId} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState
          kind={loadError ? "load_error" : page > 1 ? "page_out_of_range" : "no_results"}
          firstPageHref={basePath}
          retryHref={pageHref(page)}
        />
      )}

      {totalPages > 1 && (
        <nav aria-label="Phân trang" className="flex items-center justify-center gap-3 border-t border-line pt-6">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className={PAGE_LINK}>
              ← Trang trước
            </Link>
          )}
          <span className="px-1 text-body-sm text-ink-3">
            Trang <span className="num font-semibold text-ink">{page}</span> / <span className="num">{totalPages}</span>
          </span>
          {page < totalPages && (
            <Link href={pageHref(page + 1)} className={PAGE_LINK}>
              Trang sau →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
