import Link from "next/link";
import { after } from "next/server";
import {
  getFilterFacets,
  parseSearchParams,
  searchItemHref,
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
import { IntentChips } from "@/components/search/intent-chips";
import { resolveSearchParams } from "@/lib/search/resolve-params";
import { searchLinkParams } from "@/lib/intent/links";
import { getCurrentUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { applyPreferences, isEmptyPreferences, type Preferences } from "@/lib/preferences";
import { getPreferenceCategories, getPreferencesForUser } from "@/lib/preferences/queries";
import { PrefsToggle } from "@/components/search/prefs-toggle";
import { trackAfter } from "@/lib/analytics/track";
import { recordSearchDemand } from "@/lib/sourcing/record-demand";
import { SaveSearchButton } from "@/components/search/save-search-dialog";
import { DemandFollowBox } from "@/components/search/demand-follow-box";
import { defaultSavedSearchName, savedSearchParts, toSavedParams } from "@/lib/saved-search/params";
import { demandFollowOffer } from "@/lib/demand-follow/offer";
import { findMyDemandFollow } from "@/lib/demand-follow/queries";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const dynamic = "force-dynamic";

const PAGE_LINK =
  "inline-flex min-h-11 items-center rounded-full border border-line-strong/50 bg-surface px-5 text-body-sm font-semibold text-ink transition-colors duration-150 ease-out hover:border-primary hover:text-primary";

function hasFilterParams(params: SearchParams): boolean {
  return (
    Boolean(params.categorySlug) ||
    Boolean(params.brands && params.brands.length > 0) ||
    params.minPrice != null ||
    params.maxPrice != null ||
    params.capacityGb != null ||
    params.minRating != null ||
    Boolean(params.freeShipping) ||
    Boolean(params.hasVoucher) ||
    Boolean(params.onlyBuy) ||
    Boolean(params.marketplaces && params.marketplaces.length > 0)
  );
}

/**
 * The signed-in user's non-empty preferences plus the category id → slug map applyPreferences needs
 * (only loaded when the toggle is on). Any failure → null: preferences never take the search down.
 */
async function loadPreferences(
  userId: string | null,
  on: boolean,
): Promise<{ prefs: Preferences; categorySlugById: Map<string, string> } | null> {
  if (!userId) return null;
  try {
    const supabase = await createClient();
    const prefs = await getPreferencesForUser(supabase, userId);
    if (isEmptyPreferences(prefs)) return null;
    const categorySlugById = new Map<string, string>();
    if (on && prefs.categoryIds.length > 0) {
      for (const c of await getPreferenceCategories(supabase)) categorySlugById.set(c.id, c.slug);
    }
    return { prefs, categorySlugById };
  } catch (err) {
    console.error("search: loading preferences failed", err);
    return null;
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const raw = parseSearchParams(await searchParams);
  // Facets don't depend on the query: start them first, awaited with the results below.
  const facetsPromise = getFilterFacets();
  facetsPromise.catch(() => {});

  // Query intent (spec §3): "ssd 2tb dưới 3 triệu" → category + capacity + price chips. The URL
  // always wins over what the text says (applyIntent). getIntentVocab never throws.
  const [user, { params: intentParams, applied, demandIntent }] = await Promise.all([
    getCurrentUser().catch(() => null),
    resolveSearchParams(raw),
  ]);

  // "Theo sở thích của tôi" (spec §5, off by default): saved preferences fill what neither the URL
  // nor the query intent set. Only the searched params change — links keep `prefs=1` (carried by
  // raw/intentParams) instead of turning preferences into explicit URL filters.
  const saved = await loadPreferences(user?.id ?? null, raw.prefs === true);
  const withPrefs = (p: SearchParams): SearchParams =>
    saved && raw.prefs ? applyPreferences(p, saved.prefs, saved.categorySlugById) : p;
  const queryParams = withPrefs(intentParams);

  // A failed search must not take the whole page down: show a "retry" state instead. Facets only
  // feed the filter column, so they degrade to empty lists.
  const [searchRes, facetsRes] = await Promise.allSettled([searchProducts(queryParams), facetsPromise]);
  if (searchRes.status === "rejected") console.error("search: searchProducts failed", searchRes.reason);
  if (facetsRes.status === "rejected") console.error("search: getFilterFacets failed", facetsRes.reason);
  let loadError = searchRes.status === "rejected";
  // The params the shown results were searched with (cards link to the capacity-matched variant).
  let resultParams = queryParams;
  let result =
    searchRes.status === "fulfilled" ? searchRes.value : { items: [], total: 0, page: queryParams.page ?? 1, pageSize: 24 };

  // Intent made the search too strict → show the plain-text results instead, with a notice. Only on
  // page 1: past it, 0 rows just means "out of range".
  let fallback = false;
  if (!loadError && result.total === 0 && applied.length > 0 && (raw.page ?? 1) === 1) {
    fallback = true;
    try {
      resultParams = withPrefs({ ...raw, intent: false });
      result = await searchProducts(resultParams);
    } catch (err) {
      console.error("search: fallback searchProducts failed", err);
      loadError = true;
    }
  }

  // Sort/filter links: the applied params + intent=0. Pagination: the raw URL, re-parsed identically
  // on every page (see searchLinkParams).
  const { nav: params, pagination } = searchLinkParams({ raw, intentParams, applied, fallback });

  const facets = facetsRes.status === "fulfilled" ? facetsRes.value : { categories: [], brands: [], advanced: NO_ADVANCED_FILTERS, marketplaces: [] };

  if (!loadError) {
    trackAfter("search_performed", {
      userId: user?.id ?? null,
      props: {
        // What the user typed, not what's left after intent extraction.
        has_query: Boolean(raw.q),
        has_filters: hasFilterParams(params),
        result_count: result.total,
        page: result.page,
        sort: params.sort,
      },
    });
    // Few or no results: ask sourcing to look for this on the marketplaces (spec §6).
    after(() => recordSearchDemand({ q: raw.q, total: result.total, page: result.page, intent: demandIntent }));
    if (applied.length > 0) {
      // Allow-listed shape only — never the text the user typed.
      trackAfter("search_intent_applied", {
        userId: user?.id ?? null,
        props: {
          chips: applied.length,
          has_category: applied.some((c) => c.kind === "category"),
          has_price: applied.some((c) => c.kind === "price"),
          has_capacity: applied.some((c) => c.kind === "capacity"),
          fallback,
        },
      });
    }
  }

  // P4 E: "Lưu tìm kiếm" when the searched params have a scope (q / category / brand). The action recomputes
  // the params from the raw query string the same way, so what is saved is what the page searched.
  const savedParams = toSavedParams(intentParams);
  const canOfferSave = !loadError && Boolean(savedParams.q || savedParams.categorySlug || savedParams.brands?.length);
  const rawQuery = toSearchParams(raw).toString();
  // P4 F: the opt-in appears exactly where demand is recorded (< 3 results, page 1, valid keyword).
  const demandOffer = loadError ? null : demandFollowOffer({ q: raw.q, total: result.total, page: result.page, intent: demandIntent });
  const existingFollow =
    demandOffer && user ? await findMyDemandFollow(user.id, demandOffer.keyword).catch(() => null) : null;

  const totalPages = Math.ceil(result.total / result.pageSize);
  const currentPage = result.page;
  const categoryNames = Object.fromEntries(facets.categories.map((c) => [c.slug, c.name]));

  // Preference-filled fields count too: "too strict" must be offered when they emptied the results.
  const hasFilters = hasFilterParams(saved && raw.prefs ? withPrefs(params) : params);
  const pageHref = (page: number) => `/search?${toSearchParams({ ...pagination, page }).toString()}`;

  return (
    <main className="flex-1">
      {/* Search band: white strip under the header with the box and quick category pills. */}
      <section aria-label="Tìm kiếm" className="border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-[1440px] space-y-3.5 px-4 py-5 sm:px-6 lg:px-14">
          <div className="max-w-[820px]">
            <SearchBox initialQuery={raw.q} />
          </div>
          {raw.q && (
            // Chip links come from the intent-applied params even in fallback: dropping one condition
            // (e.g. the price) is the natural next step when all of them together found nothing.
            <IntentChips applied={applied} params={intentParams} originalQuery={raw.q} fallback={fallback} />
          )}
          <ActiveFilterChips
            params={params}
            categories={facets.categories}
            hide={fallback ? [] : applied.map((c) => c.kind)}
          />
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
              <h1 className="display text-h2-sm font-semibold leading-tight text-ink max-sm:text-h3">
                {loadError ? (
                  "Kết quả tìm kiếm"
                ) : (
                  <>
                    <span className="num font-bold text-primary">{result.total}</span>{" "}
                    <span>sản phẩm{raw.q || hasFilters ? " phù hợp" : ""}</span>
                  </>
                )}
              </h1>
              <p className="text-body-sm text-ink-2">
                {raw.q ? (
                  <>
                    Kết quả cho <strong className="font-semibold text-ink">&ldquo;{raw.q}&rdquo;</strong> · Mỗi thẻ đã gom các nơi bán cùng một mẫu
                  </>
                ) : (
                  "Mỗi thẻ đã gom các nơi bán cùng một mẫu sản phẩm"
                )}
              </p>
              {saved && (
                <div className="pt-2">
                  <PrefsToggle base={pagination} on={raw.prefs === true} />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canOfferSave ? (
                <SaveSearchButton
                  query={rawQuery}
                  signedIn={Boolean(user)}
                  parts={savedSearchParts(savedParams, savedParams.categorySlug ? categoryNames[savedParams.categorySlug] : undefined)}
                  defaultName={defaultSavedSearchName(savedParams, savedParams.categorySlug ? categoryNames[savedParams.categorySlug] : undefined)}
                  maxPrice={savedParams.maxPrice ?? null}
                  onlyBuy={savedParams.onlyBuy === true}
                />
              ) : null}
              <SortSelect
                params={params}
                baseQuery={toSearchParams({ ...params, sort: undefined, page: 1 }).toString()}
              />
            </div>
          </div>

          {demandOffer && raw.q ? (
            <DemandFollowBox
              keyword={demandOffer.keyword}
              q={raw.q}
              intent={raw.intent !== false}
              signedIn={Boolean(user)}
              loginHref={`/login?next=${encodeURIComponent(`/search?${rawQuery}`)}`}
              existing={existingFollow}
            />
          ) : null}

          {/* Product list */}
          {result.items.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {result.items.map((item) => (
                <ProductCard
                  key={item.productId}
                  item={item}
                  href={searchItemHref(item, resultParams)}
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
              query={raw.q}
              clearFiltersHref={raw.q ? `/search?${toSearchParams({ q: raw.q, intent: false }).toString()}` : "/search"}
              firstPageHref={pageHref(1)}
              retryHref={pageHref(raw.page ?? 1)}
              onlyBuyOffHref={raw.onlyBuy ? `/search?${toSearchParams({ ...raw, onlyBuy: undefined, page: 1 }).toString()}` : undefined}
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
