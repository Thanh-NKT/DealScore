"use client";

import { useCallback, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ClockIcon, SearchIcon } from "@/components/ui/icons";
import { LookupProblem } from "@/components/lookup/lookup-problem";
import { isLookupable, looksLikeLink, marketOf, slowMessage, useLookup } from "@/components/lookup/use-lookup";
import { buttonClass } from "@/components/ui/button";
import { SuggestPopup } from "@/components/search/suggest-popup";
import { useNarrow, useSearchSuggest, useSlashFocus } from "@/components/search/use-search-suggest";
import type { ComparePick } from "@/lib/search/suggest-rows";

interface SearchBoxProps {
  initialQuery?: string;
  /** Outline button, for pages where another form (the link lookup) is the main action. */
  secondary?: boolean;
  /**
   * Picker mode for /compare: a suggestion opens the comparison instead of the product page, and
   * submitting searches inside /compare (its no-JS result list). The side already chosen is kept;
   * the pick fills the other one (A first when neither is chosen).
   */
  compare?: ComparePick;
}

/** Longer than this is a pasted paragraph, not a query; the server trims and sanitises anyway. */
const MAX_QUERY = 200;

export const SEARCH_PLACEHOLDER = "Tên sản phẩm, hãng hoặc link — vd: SSD 2TB dưới 3 triệu";
export const SEARCH_PLACEHOLDER_SHORT = "Tìm sản phẩm hoặc dán link";

/**
 * Keyword search with sectioned suggestions (search row, categories, brands, products; recent searches
 * on an empty box), which also accepts a pasted Shopee link (handed to the shared lookup flow).
 * Hardened for: very long input (capped), punctuation and emoji (sent as typed; the server sanitises the
 * tsquery), no-diacritics typing (the server matches unaccented text), links from other marketplaces
 * (explained instead of searched as text), stale or failed suggestion requests, broken localStorage.
 * Keyboard: "/" focuses it (desktop), arrows walk every row, Esc closes the list then clears the text.
 * Without JavaScript it is a plain GET form to /search.
 */
export function SearchBox({ initialQuery = "", secondary = false, compare }: SearchBoxProps) {
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(initialQuery.slice(0, MAX_QUERY));
  const lookup = useLookup();
  const narrow = useNarrow();

  const trimmed = query.trim().replace(/\s+/g, " ");
  const isLink = looksLikeLink(trimmed);
  const canLookup = isLink && isLookupable(trimmed);
  const suggest = useSearchSuggest({ query: trimmed, boxEmpty: query === "", link: isLink, compare, setQuery, wrapperRef });
  const listId = `${uid}-list`;
  const optionId = useCallback((i: number) => `${uid}-opt-${i}`, [uid]);
  useSlashFocus(inputRef);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      // First Esc closes the list, the second clears the text (preventDefault: the browser's own
      // search-field Esc would clear both at once).
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
    if (compare) {
      // Picker: the native GET to /compare?q=… lists matches to choose from (also the no-JS path).
      if (!trimmed) e.preventDefault();
      else suggest.record(trimmed);
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
      return;
    }
    suggest.record(trimmed);
    // The native GET to /search?q=… runs (also the no-JS path).
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* DESIGN.md "Ô tìm kiếm": the whole frame is the field (2px border, focus ring on the frame). */}
      <form
        action={compare ? "/compare" : "/search"}
        method="get"
        role="search"
        onSubmit={onSubmit}
        className={`flex items-center gap-2.5 rounded-full border bg-surface p-1.5 pl-5 transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/15 motion-reduce:transition-none max-sm:pl-4 ${
          secondary ? "border-line" : "border-line-strong/40 shadow-lift"
        }`}
      >
        {compare?.a && <input type="hidden" name="a" value={compare.a} />}
        {compare?.b && <input type="hidden" name="b" value={compare.b} />}
        <SearchIcon className="size-5 shrink-0 text-primary max-[380px]:hidden" strokeWidth={2.2} />
        <label htmlFor={`${uid}-q`} className="sr-only">
          {compare ? "Tìm sản phẩm để so sánh" : "Tìm sản phẩm hoặc dán link sản phẩm"}
        </label>
        <input
          ref={inputRef}
          id={`${uid}-q`}
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
          placeholder={compare ? "Tên, hãng hoặc model sản phẩm…" : narrow ? SEARCH_PLACEHOLDER_SHORT : SEARCH_PLACEHOLDER}
          className="h-11 w-full min-w-0 flex-1 bg-transparent text-body text-ink placeholder:text-ink-3 focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
        />

        {canLookup && !lookup.loading && !compare && (
          <span className="hidden shrink-0 items-center rounded-full bg-accent px-2.5 py-1 text-micro font-semibold text-on-accent sm:inline-flex">
            Đã nhận link
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
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-3 transition-colors duration-150 ease-out hover:bg-surface-2 hover:text-ink motion-reduce:transition-none"
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
            className={buttonClass({ variant: "secondary", size: "md", className: "shrink-0" })}
          >
            Hủy
          </button>
        ) : (
          <button
            type="submit"
            disabled={lookup.navigating}
            className={buttonClass({ variant: secondary ? "secondary" : "primary", size: "md", className: "shrink-0 max-sm:px-4" })}
          >
            {lookup.navigating ? "Đang mở…" : canLookup && !compare ? "Phân tích link" : "Tìm kiếm"}
          </button>
        )}
      </form>

      <div id={`${uid}-status`} aria-live="polite" className="empty:hidden [&>*]:mt-2">
        {lookup.loading && (
          <p className="flex items-center gap-1.5 text-body-sm text-ink-2">
            <ClockIcon className="size-4" />
            {slowMessage(lookup.slow)}
          </p>
        )}
        {lookup.problem && <LookupProblem problem={lookup.problem} input={trimmed} onRetry={() => void lookup.run(trimmed)} />}
        {query.length >= MAX_QUERY && <p className="text-label text-ink-3">Từ khóa đã dài tối đa {MAX_QUERY} ký tự.</p>}
      </div>

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
  );
}
