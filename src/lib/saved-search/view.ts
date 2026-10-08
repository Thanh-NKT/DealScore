import { formatVnd, toVnDate } from "@/lib/format";
import { toSearchParams } from "@/lib/search";
import { defaultSavedSearchName, savedSearchParts, savedToSearchParams, type SavedSearchParams } from "@/lib/saved-search/params";
import type { MySavedSearch } from "@/lib/saved-search/queries";
import type { MyDemandFollow } from "@/lib/demand-follow/queries";

const vnShort = (iso: string) => {
  const [y, m, d] = toVnDate(iso).split("-");
  return `${d}/${m}/${y}`;
};

/** "Dưới 1.500.000đ · Nên mua" (UI spec §1.2). Pure. */
export function conditionLine(p: SavedSearchParams): string {
  return [p.maxPrice != null ? `Dưới ${formatVnd(p.maxPrice)}` : null, p.onlyBuy ? "Nên mua" : null].filter(Boolean).join(" · ");
}

/** /search link of a saved search: its re-run params with the default sort (not price_asc). */
export function savedSearchHref(p: SavedSearchParams): string {
  return `/search?${toSearchParams({ ...savedToSearchParams(p), sort: undefined, page: 1 }).toString()}`;
}

export function savedSearchRowView(s: MySavedSearch, categoryNames: Record<string, string> = {}) {
  const catName = s.params.categorySlug ? categoryNames[s.params.categorySlug] : undefined;
  const last = s.latestEventAt ?? s.lastAlertedAt;
  return {
    id: s.id,
    name: s.name,
    parts: savedSearchParts(s.params, catName),
    conditionLine: conditionLine(s.params),
    statusLine: last ? `Lần báo gần nhất ${vnShort(last)}` : "Chưa có sản phẩm mới",
    status: s.status,
    resultsHref: savedSearchHref(s.params),
    defaultName: defaultSavedSearchName(s.params, catName),
    maxPrice: s.params.maxPrice ?? null,
    onlyBuy: s.params.onlyBuy === true,
  };
}

export function demandFollowRowView(f: MyDemandFollow) {
  return {
    id: f.id,
    keyword: f.keyword,
    status: f.status,
    line:
      f.status === "waiting"
        ? `Hết hạn ${vnShort(f.expiresAt)}`
        : f.status === "found"
          ? `Đã có — đã báo ${vnShort(f.foundAt ?? f.expiresAt)}`
          : "Đã hết hạn, chưa có sản phẩm",
    resultsHref: `/search?${new URLSearchParams({ q: f.keyword }).toString()}`,
  };
}
