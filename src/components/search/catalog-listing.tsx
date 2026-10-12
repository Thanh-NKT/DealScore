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
  "inline-flex min-h-11 items-center rounded-full border border-line-strong/50 bg-surface px-5 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary";

/**
 * SSR listing for the SEO landing pages (/{category}, /brand/{brand}), 1.7. Same cards and
 * pagination as /search; works without JavaScript.
 */
export function CatalogListing({ title, result, basePath, searchHref, loadError, aside }: CatalogListingProps) {
  const totalPages = Math.ceil(result.total / result.pageSize);
  const page = result.page;
  const pageHref = (n: number) => (n <= 1 ? basePath : `${basePath}?page=${n}`);

  return (
    <main className="w-full flex-1">
      <header className="border-b border-line bg-ledger">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-x-6 gap-y-4 px-4 py-10 sm:px-6 sm:py-14 lg:px-14">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="eyebrow text-ink-3">Bảng giá</span>
            <h1 className="display text-h1 leading-[1.05] font-semibold text-balance text-ink max-sm:text-h1-sm">{title}</h1>
            <p className="text-body text-ink-2">
              <span className="num font-bold text-primary">{result.total}</span> sản phẩm, giá theo dõi hằng ngày
            </p>
          </div>
          <Link
            href={searchHref}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-5 text-body-sm font-semibold text-on-primary transition-colors duration-150 ease-out hover:bg-primary-hover"
          >
            Lọc theo giá, sắp xếp
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1440px] space-y-8 px-4 py-8 sm:px-6 sm:py-10 lg:px-14">
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
      </div>
    </main>
  );
}
