"use client";

import type { SearchParams } from "@/lib/search";

/**
 * Sort selector for search results.
 *
 * A Client Component because it needs onChange to auto-submit when JS is on. Without JS,
 * the button inside <noscript> does it — the page stays fully usable (a requirement for
 * SSR/SEO in section 1.7 to mean anything).
 *
 * The form must carry EVERY current parameter as hidden inputs. Sending only
 * `sort` would silently drop the query and every filter when the sort changes.
 */
export function SortSelect({ params }: { params: SearchParams }) {
  const sort = params.sort ?? (params.q ? "relevance" : "updated");

  return (
    <form method="get" className="flex items-center gap-2 text-xs">
      {params.q ? <input type="hidden" name="q" value={params.q} /> : null}
      {params.categorySlug ? (
        <input type="hidden" name="cat" value={params.categorySlug} />
      ) : null}
      {params.categoryId ? (
        <input type="hidden" name="catId" value={params.categoryId} />
      ) : null}
      {(params.brands ?? []).map((b) => (
        <input key={b} type="hidden" name="brand" value={b} />
      ))}
      {params.minPrice != null ? (
        <input type="hidden" name="min" value={String(params.minPrice)} />
      ) : null}
      {params.maxPrice != null ? (
        <input type="hidden" name="max" value={String(params.maxPrice)} />
      ) : null}

      <label htmlFor="sort-select" className="text-muted font-medium whitespace-nowrap">
        Sắp xếp:
      </label>

      <select
        id="sort-select"
        name="sort"
        defaultValue={sort}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none font-medium cursor-pointer"
      >
        <option value="relevance">Khớp nhất</option>
        <option value="deal_score">Deal Score cao nhất</option>
        <option value="price_asc">Giá tăng dần</option>
        <option value="price_desc">Giá giảm dần</option>
        <option value="updated">Mới cập nhật</option>
      </select>

      <noscript>
        <button
          type="submit"
          className="rounded-lg border border-border px-2 py-1 text-xs"
        >
          Sắp xếp
        </button>
      </noscript>
    </form>
  );
}
