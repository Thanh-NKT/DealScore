"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import type { AutocompleteResponse } from "@/lib/search/autocomplete-types";
import { fetchSuggestions } from "@/lib/search/fetch-suggestions";
import { addRecent, clearRecent, readRecent, removeRecent } from "@/lib/search/recent-searches";
import { activeAfterRemoval, listKeyAction } from "@/lib/search/suggest-keys";
import { MIN_SUGGEST, buildSuggestions, flattenGroups, type ComparePick, type SuggestRow } from "@/lib/search/suggest-rows";

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
      // Suggestions are a convenience: a failed or offline request answers "no suggestions" (so the
      // list leaves its loading state), Enter still searches. null = aborted, a newer query is coming.
      const answer = await fetchSuggestions(query, { limit, signal: controller.signal });
      if (!answer) return;
      setData(answer);
      setActive(-1);
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

  const record = useCallback((q: string) => setRecent(addRecent(q, undefined, recent)), [recent]);

  const clearAll = () => {
    setRecent(clearRecent());
    setActive(-1);
  };

  const pick = (row: SuggestRow) => {
    if (row.kind === "clear-recent") {
      clearAll();
      return;
    }
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

  /** Removes a recent search; the keyboard stays on the row that took its place. */
  const removeOne = (q: string, index = -1) => {
    const left = removeRecent(q, undefined, recent);
    setRecent(left);
    setActive(index >= 0 ? activeAfterRemoval(index, left.length) : -1);
  };

  /** Arrow keys, Enter, Delete / Backspace and Tab on the list (src/lib/search/suggest-keys.ts). Returns true when handled. */
  const onListKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    const action = listKeyAction({
      key: e.key,
      composing: e.nativeEvent.isComposing,
      listVisible,
      rows,
      active: activeIndex,
    });
    if (!action) return false;
    if (action.type === "close") {
      setOpen(false);
      return false;
    }
    e.preventDefault();
    if (action.type === "open") setOpen(true);
    else if (action.type === "move") setActive(action.to);
    else if (action.type === "pick") pick(action.row);
    else removeOne(action.q, action.index);
    return true;
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
    clearRecent: clearAll,
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
