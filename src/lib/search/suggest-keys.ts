/**
 * Keyboard model of the search box's suggestion list (ARIA 1.2 combobox + listbox, focus stays in the
 * input and the active row is `aria-activedescendant`). Pure, so every key is unit-tested; the hook
 * only applies the action.
 *
 * - ArrowDown / ArrowUp walk every row (wrapping); ArrowDown on a closed list opens it.
 * - Enter on the active row picks it ("Xóa lịch sử" is a row too, so clearing works from the keyboard).
 *   With no active row Enter is left to the form (native submit).
 * - Delete / Backspace on an active recent-search row removes it. Recent rows are only listed while the
 *   box is empty, so Backspace there never eats typed text. Announced on the row (`RECENT_REMOVE_HINT`).
 * - Tab closes the list and moves on as usual.
 */
import type { SuggestRow } from "@/lib/search/suggest-rows";

/** Read by screen readers on a recent row (its `aria-describedby`) and shown on the active row. */
export const RECENT_REMOVE_HINT = "Nhấn Delete để xóa khỏi lịch sử";
/** `aria-keyshortcuts` of a recent row. */
export const RECENT_REMOVE_KEYS = "Delete Backspace";

export type ListKeyAction =
  /** Handled: the caller prevents the browser default. */
  | { type: "open" }
  | { type: "move"; to: number }
  | { type: "pick"; row: SuggestRow }
  | { type: "remove"; q: string; index: number }
  /** Not handled (the key goes through), but the list closes. */
  | { type: "close" };

export function listKeyAction({
  key,
  composing,
  listVisible,
  rows,
  active,
}: {
  key: string;
  /** An IME composition is in progress: its keys belong to the IME. */
  composing: boolean;
  listVisible: boolean;
  rows: readonly SuggestRow[];
  /** Active row index, -1 for none. */
  active: number;
}): ListKeyAction | null {
  if (composing) return null;
  if (!listVisible) return key === "ArrowDown" && rows.length > 0 ? { type: "open" } : null;
  const current = active >= 0 && active < rows.length ? active : -1;
  switch (key) {
    case "ArrowDown":
      return { type: "move", to: (current + 1) % rows.length };
    case "ArrowUp":
      return { type: "move", to: current <= 0 ? rows.length - 1 : current - 1 };
    case "Enter":
      return current >= 0 ? { type: "pick", row: rows[current] } : null;
    case "Delete":
    case "Backspace": {
      const row = rows[current];
      return row?.kind === "recent" ? { type: "remove", q: row.q, index: current } : null;
    }
    case "Tab":
      return { type: "close" };
    default:
      return null;
  }
}

/** The active row after removing recent row `index`: the row that took its place, else the new last recent row. */
export function activeAfterRemoval(index: number, recentLeft: number): number {
  if (recentLeft <= 0) return -1;
  return Math.min(index, recentLeft - 1);
}
