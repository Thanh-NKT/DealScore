"use client";

import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClockIcon, SearchIcon } from "@/components/ui/icons";
import { LookupProblem } from "@/components/lookup/lookup-problem";
import { isLookupable, looksLikeLink, marketOf, slowMessage, useLookup } from "@/components/lookup/use-lookup";
import { buttonClass } from "@/components/ui/button";
import { SuggestPopup } from "@/components/search/suggest-popup";
import { useNarrow, useSearchSuggest, useSlashFocus } from "@/components/search/use-search-suggest";
import { SEARCH_PLACEHOLDER, SEARCH_PLACEHOLDER_SHORT } from "@/components/search/search-box";

const MAX_QUERY = 200;

const QUICK_QUERIES = [
  "nồi chiên không dầu dưới 2 triệu",
  "kem chống nắng cho da dầu",
  "tã quần size XL giá tốt",
];

/**
 * Homepage Hero search & Shopee link lookup bar.
 * - Automatically detects pasted Shopee links (shopee.vn / shope.ee) and runs `/api/lookup` directly.
 * - Explains unsupported marketplace links (TikTok Shop, Lazada, Tiki) instead of running a dead text search.
 * - Same sectioned suggestions, recent searches and keyboard behaviour as `SearchBox` (shared hook + popup).
 */
export function HeroSearchForm() {
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const lookup = useLookup();
  const narrow = useNarrow();

  const trimmed = query.trim().replace(/\s+/g, " ");
  const isLink = looksLikeLink(trimmed);
  const canLookup = isLink && isLookupable(trimmed);
  const suggest = useSearchSuggest({ query: trimmed, boxEmpty: query === "", link: isLink, limit: 6, delay: 220, setQuery, wrapperRef });
  const listId = `${uid}-list`;
  const optionId = useCallback((i: number) => `${uid}-opt-${i}`, [uid]);
  useSlashFocus(inputRef);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (suggest.popupVisible) {
        e.preventDefault();
        suggest.setOpen(false);
      } else if (query) {
        e.preventDefault();
        setQuery("");
        lookup.clearProblem();
      }
      return;
    }
    suggest.onListKey(e);
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    suggest.setOpen(false);
    if (canLookup) {
      e.preventDefault();
      void lookup.run(trimmed);
      return;
    }
    if (isLink) {
      e.preventDefault();
      lookup.showProblem({ code: "not_shopee", market: marketOf(trimmed) });
      return;
    }
    if (!trimmed) {
      e.preventDefault();
      router.push("/search");
      return;
    }
    suggest.record(trimmed);
  };

  return (
    <div ref={wrapperRef} className="flex max-w-[700px] flex-col gap-3">
      <div className="relative w-full">
        <form
          action="/search"
          method="get"
          role="search"
          onSubmit={onSubmit}
          className="flex items-center gap-2.5 rounded-lg border-2 border-line-strong bg-surface p-2 pl-4 transition-colors focus-within:border-primary motion-reduce:transition-none sm:pl-5"
        >
          <SearchIcon className="size-[22px] shrink-0 text-ink-2 max-[380px]:hidden" />
          <label htmlFor={`${uid}-home-q`} className="sr-only">
            Tìm sản phẩm hoặc dán link Shopee
          </label>
          <input
            ref={inputRef}
            id={`${uid}-home-q`}
            type="search"
            name="q"
            value={query}
            maxLength={MAX_QUERY}
            autoComplete="off"
            enterKeyHint="search"
            onChange={(e) => {
              setQuery(e.target.value.slice(0, MAX_QUERY));
              suggest.onInput();
              lookup.clearProblem();
            }}
            onFocus={suggest.onFocus}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggest.listVisible}
            aria-controls={suggest.listVisible ? listId : undefined}
            aria-activedescendant={suggest.listVisible && suggest.active >= 0 ? optionId(suggest.active) : undefined}
            aria-describedby={`${uid}-status`}
            aria-keyshortcuts="/"
            readOnly={lookup.loading}
            placeholder={narrow ? SEARCH_PLACEHOLDER_SHORT : SEARCH_PLACEHOLDER}
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
                inputRef.current?.focus();
              }}
              className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink motion-reduce:transition-none"
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

        {suggest.popupVisible && (
          <SuggestPopup
            listId={listId}
            optionId={optionId}
            suggestions={suggest.suggestions}
            query={trimmed}
            active={suggest.active}
            pending={suggest.pending}
            onHover={suggest.setActive}
            onPick={suggest.pick}
            onRemoveRecent={suggest.removeRecent}
          />
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
