/**
 * Rows of the search suggestion list, in display (and arrow-key) order (spec 2026-10-07-search-quality-ui §2):
 * the "Tìm “q”" row, then categories, brands, products; an empty box shows recent searches instead.
 * Pure, so the ordering is unit-tested; the component only renders what this returns.
 */
import type { AutocompleteItem, AutocompleteResponse } from "@/lib/search/autocomplete-types";

export const MIN_SUGGEST = 2;

export interface ComparePick {
  a?: string;
  b?: string;
}

export type SuggestRow =
  | { kind: "query"; q: string; chips: string[]; href: string }
  | { kind: "category"; name: string; href: string }
  | { kind: "brand"; name: string; href: string }
  | { kind: "product"; item: AutocompleteItem; href: string }
  | { kind: "recent"; q: string; href: string };

export interface SuggestGroup {
  key: "query" | "category" | "brand" | "product" | "recent";
  /** Section heading; null for the search row, which needs none. */
  label: string | null;
  rows: SuggestRow[];
}

export interface Suggestions {
  groups: SuggestGroup[];
  /** The answer for exactly this query has nothing to suggest ("Không có gợi ý"). */
  empty: boolean;
}

/** The comparison URL after picking `picked`: the side already chosen is kept, the pick fills the other (A first). */
export function compareHref(keep: ComparePick, picked: string): string {
  const q = new URLSearchParams();
  if (keep.a) {
    q.set("a", keep.a);
    q.set("b", picked);
  } else {
    q.set("a", picked);
    if (keep.b) q.set("b", keep.b);
  }
  return `/compare?${q.toString()}`;
}

/** Where submitting `q` goes: /search, or the /compare picker's own result list (keeping the chosen side). */
export function queryHref(q: string, compare?: ComparePick): string {
  const p = new URLSearchParams();
  if (compare?.a) p.set("a", compare.a);
  if (compare?.b) p.set("b", compare.b);
  p.set("q", q);
  return `${compare ? "/compare" : "/search"}?${p.toString()}`;
}

export function buildSuggestions({
  q,
  data,
  recent,
  compare,
  link = false,
}: {
  /** What is in the box now (trimmed, single spaces). */
  q: string;
  /** The latest answer, possibly for an earlier query while the next one loads; null before the first. */
  data: AutocompleteResponse | null;
  recent: string[];
  compare?: ComparePick;
  /** The box holds a link: the lookup flow owns it, no suggestions. */
  link?: boolean;
}): Suggestions {
  if (link) return { groups: [], empty: false };

  if (q === "") {
    if (recent.length === 0) return { groups: [], empty: false };
    const rows: SuggestRow[] = recent.map((r) => ({ kind: "recent", q: r, href: queryHref(r, compare) }));
    return { groups: [{ key: "recent", label: "Tìm gần đây", rows }], empty: false };
  }
  if (q.length < MIN_SUGGEST) return { groups: [], empty: false };

  const fresh = data !== null && data.q === q;
  const categories = compare ? [] : (data?.categories ?? []);
  const brands = compare ? [] : (data?.brands ?? []);
  const products = data?.products ?? [];
  if (fresh && categories.length + brands.length + products.length === 0) return { groups: [], empty: true };

  const groups: SuggestGroup[] = [
    {
      key: "query",
      label: null,
      rows: [{ kind: "query", q, chips: fresh ? data.intent.map((c) => c.label) : [], href: queryHref(q, compare) }],
    },
  ];
  if (categories.length > 0) {
    groups.push({ key: "category", label: "Danh mục", rows: categories.map((c) => ({ kind: "category", name: c.name, href: c.href })) });
  }
  if (brands.length > 0) {
    groups.push({ key: "brand", label: "Hãng", rows: brands.map((b) => ({ kind: "brand", name: b.name, href: b.href })) });
  }
  if (products.length > 0) {
    groups.push({
      key: "product",
      label: "Sản phẩm",
      rows: products.map((item) => ({
        kind: "product",
        item,
        href: compare ? compareHref(compare, item.slug) : `/${item.categorySlug}/${item.slug}`,
      })),
    });
  }
  return { groups, empty: false };
}

export function flattenGroups(groups: SuggestGroup[]): SuggestRow[] {
  return groups.flatMap((g) => g.rows);
}
