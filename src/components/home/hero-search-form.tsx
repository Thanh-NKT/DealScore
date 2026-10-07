"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AutocompleteResponse } from "@/lib/search/autocomplete-types";
import { formatVnd } from "@/lib/format";
import { ClockIcon, SearchIcon } from "@/components/ui/icons";
import { ProductImage } from "@/components/ui/product-image";
import { LookupProblem } from "@/components/lookup/lookup-problem";
import { isLookupable, looksLikeLink, marketOf, slowMessage, useLookup } from "@/components/lookup/use-lookup";
import { buttonClass } from "@/components/ui/button";

interface Suggestion {
  productId: string;
  slug: string;
  categorySlug: string;
  name: string;
  brand: string | null;
  image: string | null;
  bestPrice: number | null;
}

const MAX_QUERY = 200;
const MIN_SUGGEST = 2;

const QUICK_QUERIES = [
  "nồi chiên không dầu dưới 2 triệu",
  "kem chống nắng cho da dầu",
  "tã quần size XL giá tốt",
];

/**
 * Homepage Hero search & Shopee link lookup bar.
 * - Automatically detects pasted Shopee links (shopee.vn / shope.ee) and runs `/api/lookup` directly.
 * - Explains unsupported marketplace links (TikTok Shop, Lazada, Tiki) instead of running a dead text search.
 * - Provides live autocomplete dropdown for keyword queries.
 */
export function HeroSearchForm() {
  const router = useRouter();
  const uid = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ q: string; items: Suggestion[] }>({ q: "", items: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lookup = useLookup();

  const trimmed = query.trim().replace(/\s+/g, " ");
  const isLink = looksLikeLink(trimmed);
  const canLookup = isLink && isLookupable(trimmed);
  const suggestions = !isLink && trimmed.length >= MIN_SUGGEST && results.q === trimmed ? results.items : [];
  const showList = open && suggestions.length > 0;

  useEffect(() => {
    if (isLink || trimmed.length < MIN_SUGGEST) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(trimmed.slice(0, 100))}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const products = (data as Partial<AutocompleteResponse> | null)?.products;
        if (!Array.isArray(products)) return;
        setResults({ q: trimmed, items: (products as Suggestion[]).slice(0, 6) });
        setActive(-1);
      } catch {
        // Ignore aborted or offline autocomplete errors
      }
    }, 220);
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
    router.push(`/${s.categorySlug}/${s.slug}`);
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
    if (canLookup) {
      e.preventDefault();
      setOpen(false);
      void lookup.run(trimmed);
      return;
    }
    if (isLink) {
      e.preventDefault();
      setOpen(false);
      lookup.showProblem({ code: "not_shopee", market: marketOf(trimmed) });
      return;
    }
    if (!trimmed) {
      e.preventDefault();
      router.push("/search");
    }
  };

  return (
    <div ref={wrapperRef} className="flex max-w-[700px] flex-col gap-3">
      <div className="relative w-full">
        <form
          action="/search"
          method="get"
          role="search"
          onSubmit={onSubmit}
          className="flex items-center gap-2.5 rounded-lg border-2 border-line-strong bg-surface p-2 pl-4 transition-colors focus-within:border-primary sm:pl-5"
        >
          <SearchIcon className="size-[22px] shrink-0 text-ink-2 max-[380px]:hidden" />
          <label htmlFor={`${uid}-home-q`} className="sr-only">
            Tìm sản phẩm hoặc dán link Shopee
          </label>
          <input
            id={`${uid}-home-q`}
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
            placeholder="Gõ tên sản phẩm, nhu cầu, hoặc dán link Shopee…"
            className="h-13 min-w-0 flex-1 border-none bg-transparent text-body text-ink outline-none placeholder:text-ink-3 focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />

          {canLookup && !lookup.loading && (
            <span className="hidden shrink-0 items-center rounded-sm bg-primary-soft px-2.5 py-1 text-micro font-semibold text-primary sm:inline-flex">
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
                document.getElementById(`${uid}-home-q`)?.focus();
              }}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
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
              className="flex h-13 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface px-5 text-control font-semibold text-ink transition-colors hover:bg-surface-2"
            >
              Hủy
            </button>
          ) : (
            <button
              type="submit"
              disabled={lookup.navigating}
              className={buttonClass({ size: "lg", className: "shrink-0 max-[480px]:px-4 max-[480px]:text-control" })}
            >
              {lookup.navigating ? "Đang mở…" : canLookup ? "Phân tích link" : "Kiểm tra giá"}
            </button>
          )}
        </form>

        {showList && (
          <ul
            id={`${uid}-list`}
            role="listbox"
            aria-label="Gợi ý sản phẩm"
            className="absolute z-50 mt-2 max-h-80 w-full overflow-auto rounded-md border border-line bg-surface py-1.5 shadow-lift"
          >
            {suggestions.map((s, i) => {
              const name = s.name?.trim() || "Sản phẩm chưa có tên";
              const price = s.bestPrice != null && s.bestPrice > 0 ? s.bestPrice : null;
              return (
                <li
                  key={s.productId}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => go(s)}
                  onMouseEnter={() => setActive(i)}
                  className={`grid cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2 ${
                    i === active ? "bg-surface-2" : ""
                  }`}
                >
                  <div className="size-9 overflow-hidden rounded-sm bg-surface-2">
                    <ProductImage src={s.image} className="bg-surface-2! p-0.5" iconClassName="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-body-sm font-medium text-ink" title={name}>
                      {name}
                    </p>
                    {s.brand?.trim() && <p className="truncate text-micro text-ink-3">{s.brand.trim()}</p>}
                  </div>
                  {price != null ? (
                    <span className="num shrink-0 text-body-sm font-bold text-ink">{formatVnd(price)}</span>
                  ) : (
                    <span className="shrink-0 text-micro text-ink-3">Chưa có giá</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div id={`${uid}-status`} aria-live="polite" className="empty:hidden">
        {lookup.loading && (
          <p className="flex items-center gap-1.5 text-body-sm text-ink-2">
            <ClockIcon className="size-4 text-primary" />
            {slowMessage(lookup.slow)}
          </p>
        )}
        {lookup.problem && (
          <LookupProblem problem={lookup.problem} input={trimmed} onRetry={() => void lookup.run(trimmed)} />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span className="text-label font-semibold text-ink-3">Thử tìm:</span>
        {QUICK_QUERIES.map((q) => (
          <Link
            key={q}
            href={`/search?q=${encodeURIComponent(q)}`}
            className="flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-label font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            <SearchIcon className="size-3.5 text-primary" />
            {q}
          </Link>
        ))}
      </div>
    </div>
  );
}
