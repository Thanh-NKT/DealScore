"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { AutocompleteResponse } from "@/lib/search/autocomplete-types";
import { addRecent, clearRecent, readRecent, removeRecent } from "@/lib/search/recent-searches";
import { MIN_SUGGEST, buildSuggestions, flattenGroups, type ComparePick, type SuggestRow } from "@/lib/search/suggest-rows";

/** Server caps the query at 100 characters too; longer is never sent. */
const MAX_SENT = 100;

/** Keeps only the fields the list renders, so a malformed answer cannot crash the box. */
function parseAnswer(q: string, raw: unknown, limit: number): AutocompleteResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<AutocompleteResponse>;
  if (!Array.isArray(r.products)) return null;
  const list = <T,>(v: T[] | undefined) => (Array.isArray(v) ? v : []);
  return {
    q,
    products: r.products.slice(0, limit),
    brands: list(r.brands).slice(0, 3),
    categories: list(r.categories).slice(0, 3),
    intent: list(r.intent).filter((c) => typeof c?.label === "string" && c.label.trim() !== ""),
  };
}

/**
 * State and behaviour of the suggestion list shared by the search box and the homepage hero:
 * debounced fetch (previous list kept while the next loads), recent searches, the active row for the
 * ARIA combobox, and what picking a row does (navigate + record the query).
 */
export function useSearchSuggest({
  query,
  link,
  compare,
  limit = 8,
  delay = 250,
  setQuery,
  wrapperRef,
}: {
  /** Trimmed, single-spaced text in the box. */
  query: string;
  /** The box holds a link (the lookup flow owns it). */
  link: boolean;
  compare?: ComparePick;
  limit?: number;
  delay?: number;
  setQuery: (q: string) => void;
  /** The box and its list: a mousedown outside closes the list. */
  wrapperRef: RefObject<HTMLDivElement | null>;
}) {
  const router = useRouter();
  const [data, setData] = useState<AutocompleteResponse | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const suggestions = buildSuggestions({ q: query, data, recent, compare, link });
  const rows = flattenGroups(suggestions.groups);
  const activeIndex = active < rows.length ? active : -1;
  const wantsAnswer = !link && query.length >= MIN_SUGGEST;
  const pending = wantsAnswer && data?.q !== query;
  const popupVisible = open && (rows.length > 0 || suggestions.empty);
  const listVisible = open && rows.length > 0;

  useEffect(() => {
    if (!wantsAnswer) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query.slice(0, MAX_SENT))}`, { signal: controller.signal });
        // Suggestions are a convenience: on failure show "no suggestions", Enter still searches.
        const answer = res.ok ? parseAnswer(query, await res.json(), limit) : null;
        setData(answer ?? { q: query, products: [], brands: [], categories: [], intent: [] });
        setActive(-1);
      } catch {
        // Aborted (a newer query is on its way) or offline: keep what is shown.
      }
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, wantsAnswer, limit, delay]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [wrapperRef]);

  const record = useCallback((q: string) => setRecent(addRecent(q)), []);

  const pick = (row: SuggestRow) => {
    setOpen(false);
    setActive(-1);
    if (row.kind === "recent") {
      setQuery(row.q);
      record(row.q);
    } else if (row.kind === "query") {
      record(row.q);
    } else if (query) {
      record(query);
    }
    router.push(row.href);
  };

  const removeOne = (q: string) => {
    setRecent(removeRecent(q));
    setActive(-1);
  };

  /** Arrow keys, Enter and Delete on the list. Returns true when the key was handled. */
  const onListKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (e.nativeEvent.isComposing) return false;
    if (!listVisible) {
      if (e.key === "ArrowDown" && rows.length > 0) {
        e.preventDefault();
        setOpen(true);
        return true;
      }
      return false;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % rows.length);
      return true;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex <= 0 ? rows.length - 1 : activeIndex - 1);
      return true;
    }
    if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      pick(rows[activeIndex]);
      return true;
    }
    const row = rows[activeIndex];
    if (e.key === "Delete" && row?.kind === "recent") {
      e.preventDefault();
      removeOne(row.q);
      return true;
    }
    if (e.key === "Tab") setOpen(false);
    return false;
  };

  return {
    suggestions,
    rows,
    active: activeIndex,
    setActive,
    open,
    setOpen,
    pending,
    popupVisible,
    listVisible,
    pick,
    onListKey,
    record,
    /** The person typed: show the list again from the top. */
    onInput: () => {
      setOpen(true);
      setActive(-1);
    },
    onFocus: () => {
      setRecent(readRecent());
      setOpen(true);
    },
    removeRecent: removeOne,
    clearRecent: () => {
      setRecent(clearRecent());
      setActive(-1);
    },
  };
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

/** "/" focuses the box, on devices with a fine pointer (desktop), unless the person is typing elsewhere. */
export function useSlashFocus(input: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target) || !window.matchMedia("(pointer: fine)").matches) return;
      const el = input.current;
      if (!el || el.offsetParent === null) return; // hidden box
      e.preventDefault();
      el.focus();
      el.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [input]);
}

const NARROW = "(max-width: 639px)";
function subscribeNarrow(cb: () => void) {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

/** True below 640px; false on the server and during hydration (the long placeholder is the default). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}
