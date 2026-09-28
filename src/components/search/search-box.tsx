"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { formatVnd } from "@/lib/format";
import { ClockIcon, SearchIcon } from "@/components/ui/icons";
import { ProductImage } from "@/components/ui/product-image";
import { LookupProblem } from "@/components/lookup/lookup-problem";
import { isLookupable, looksLikeLink, marketOf, slowMessage, useLookup } from "@/components/lookup/use-lookup";

interface Suggestion {
  productId: string;
  slug: string;
  categorySlug: string;
  name: string;
  brand: string | null;
  image: string | null;
  bestPrice: number | null;
}

interface SearchBoxProps {
  initialQuery?: string;
  /** Outline button, for pages where another form (the link lookup) is the main action. */
  secondary?: boolean;
  /**
   * Picker mode for /compare: a suggestion opens the comparison instead of the product page, and
   * submitting searches inside /compare (its no-JS result list). The side already chosen is kept;
   * the pick fills the other one (A first when neither is chosen).
   */
  compare?: { a?: string; b?: string };
}

function compareHref(keep: { a?: string; b?: string }, picked: string): string {
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

/** Longer than this is a pasted paragraph, not a query; the server trims and sanitises anyway. */
const MAX_QUERY = 200;
const MIN_SUGGEST = 2;

/**
 * Keyword search with autocomplete, which also accepts a pasted Shopee link (handed to the shared
 * lookup flow). Hardened for: very long input (capped), punctuation and emoji (sent as typed; the
 * server sanitises the tsquery), no-diacritics typing (the server matches unaccented text), links from
 * other marketplaces (explained instead of searched as text), stale or failed suggestion requests.
 * Without JavaScript it is a plain GET form to /search.
 */
export function SearchBox({ initialQuery = "", secondary = false, compare }: SearchBoxProps) {
  const router = useRouter();
  const uid = useId();
  const [query, setQuery] = useState(initialQuery.slice(0, MAX_QUERY));
  const [results, setResults] = useState<{ q: string; items: Suggestion[] }>({ q: "", items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lookup = useLookup();

  const trimmed = query.trim().replace(/\s+/g, " ");
  const isLink = looksLikeLink(trimmed);
  const canLookup = isLink && isLookupable(trimmed);
  // Only show suggestions that belong to what is in the box right now (no stale results).
  const suggestions = !isLink && trimmed.length >= MIN_SUGGEST && results.q === trimmed ? results.items : [];
  const showList = open && suggestions.length > 0;

  useEffect(() => {
    if (isLink || trimmed.length < MIN_SUGGEST) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(trimmed.slice(0, 100))}`, { signal: controller.signal });
        if (!res.ok) return; // suggestions are a convenience: fail quietly, search still works
        const data: unknown = await res.json();
        if (!Array.isArray(data)) return;
        setResults({ q: trimmed, items: (data as Suggestion[]).slice(0, 8) });
        setActive(-1);
      } catch {
        // aborted or offline: keep whatever was shown, the search button still works
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, isLink]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (s: Suggestion) => {
    setOpen(false);
    router.push(compare ? compareHref(compare, s.slug) : `/${s.categorySlug}/${s.slug}`);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!showList) {
      if (e.key === "ArrowDown" && suggestions.length > 0) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      go(suggestions[active]);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (compare) {
      // Picker: the native GET to /compare?q=… lists matches to choose from (also the no-JS path).
      if (!trimmed) e.preventDefault();
      return;
    }
    if (canLookup) {
      e.preventDefault();
      void lookup.run(trimmed);
      return;
    }
    if (isLink) {
      // A link we can't read: searching its text would only say "no results" and hide the reason.
      e.preventDefault();
      lookup.showProblem({ code: "not_shopee", market: marketOf(trimmed) });
      return;
    }
    if (!trimmed) {
      e.preventDefault();
      router.push("/search");
    }
    // Otherwise the native GET to /search?q=… runs (also the no-JS path).
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* DESIGN.md "Ô tìm kiếm": the whole frame is the field (2px border, focus ring on the frame). */}
      <form
        action={compare ? "/compare" : "/search"}
        method="get"
        role="search"
        onSubmit={onSubmit}
        className={`flex items-center gap-2.5 rounded-[16px] border-2 bg-surface p-1.5 pl-4 transition-colors duration-150 ease-out focus-within:border-primary max-sm:pl-3.5 ${
          secondary ? "border-line" : "border-line-strong"
        }`}
      >
        {compare?.a && <input type="hidden" name="a" value={compare.a} />}
        {compare?.b && <input type="hidden" name="b" value={compare.b} />}
        <SearchIcon className="size-5 shrink-0 text-ink-2 max-[380px]:hidden" />
        <label htmlFor={`${uid}-q`} className="sr-only">
          {compare ? "Tìm sản phẩm để so sánh" : "Tìm sản phẩm hoặc dán link Shopee"}
        </label>
        <input
          id={`${uid}-q`}
          type="search"
          name="q"
          value={query}
          maxLength={MAX_QUERY}
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => {
            setQuery(e.target.value.slice(0, MAX_QUERY));
            setOpen(true);
            lookup.clearProblem();
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={`${uid}-list`}
          aria-activedescendant={showList && active >= 0 ? `${uid}-opt-${active}` : undefined}
          aria-describedby={`${uid}-status`}
          readOnly={lookup.loading}
          placeholder={compare ? "Tên, hãng hoặc model sản phẩm…" : "Tìm tên sản phẩm, hãng, model hoặc dán link Shopee…"}
          className="h-11 w-full min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />

        {canLookup && !lookup.loading && !compare && (
          <span className="hidden shrink-0 items-center rounded-sm bg-primary-soft px-2.5 py-1 text-[12px] font-semibold text-primary sm:inline-flex">
            Link Shopee
          </span>
        )}

        {query && !lookup.loading && (
          <button
            type="button"
            aria-label="Xóa nội dung tìm kiếm"
            onClick={() => {
              setQuery("");
              lookup.clearProblem();
              document.getElementById(`${uid}-q`)?.focus();
            }}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink cursor-pointer"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true" className="size-4">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}

        {lookup.loading ? (
          <button
            type="button"
            onClick={lookup.cancel}
            className="inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border border-line-strong bg-surface px-5 text-[14px] font-semibold text-ink transition-colors duration-150 ease-out hover:bg-surface-2 cursor-pointer"
          >
            Hủy
          </button>
        ) : (
          <button
            type="submit"
            disabled={lookup.navigating}
            className={`inline-flex h-11 shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] px-5 text-[15px] font-bold transition-colors duration-150 ease-out cursor-pointer disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-2 disabled:text-ink-3 max-sm:px-4 ${
              secondary
                ? "border border-line-strong bg-surface text-ink hover:bg-surface-2"
                : "bg-primary text-on-primary hover:bg-primary-hover"
            }`}
          >
            {lookup.navigating ? "Đang mở…" : canLookup && !compare ? "Phân tích link" : "Tìm kiếm"}
          </button>
        )}
      </form>

      <div id={`${uid}-status`} aria-live="polite" className="empty:hidden [&>*]:mt-2">
        {lookup.loading && (
          <p className="flex items-center gap-1.5 text-[14px] text-ink-2">
            <ClockIcon className="size-4" />
            {slowMessage(lookup.slow)}
          </p>
        )}
        {lookup.problem && <LookupProblem problem={lookup.problem} input={trimmed} onRetry={() => void lookup.run(trimmed)} />}
        {query.length >= MAX_QUERY && <p className="text-[13px] text-ink-3">Từ khóa đã dài tối đa {MAX_QUERY} ký tự.</p>}
      </div>

      {showList && (
        <ul id={`${uid}-list`} role="listbox" aria-label="Gợi ý sản phẩm" className="absolute z-50 mt-2 max-h-96 w-full overflow-auto rounded-md border border-line bg-surface py-1.5 shadow-lift">
          {suggestions.map((s, i) => {
            const name = s.name?.trim() || "Sản phẩm chưa có tên";
            const price = s.bestPrice != null && s.bestPrice > 0 ? s.bestPrice : null;
            return (
              <li
                key={s.productId}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} // keep focus in the input
                onClick={() => go(s)}
                onMouseEnter={() => setActive(i)}
                className={`grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 ${i === active ? "bg-surface-2" : ""}`}
              >
                <div className="overflow-hidden rounded-sm bg-surface-2">
                  <ProductImage src={s.image} className="bg-surface-2! p-0.5" iconClassName="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium text-ink" title={name}>
                    {name}
                  </p>
                  {s.brand?.trim() && <p className="truncate text-[12px] text-ink-3">{s.brand.trim()}</p>}
                </div>
                {price != null ? (
                  <span className="num shrink-0 text-[14px] font-bold text-ink">{formatVnd(price)}</span>
                ) : (
                  <span className="shrink-0 text-[12px] text-ink-3">Chưa có giá</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
