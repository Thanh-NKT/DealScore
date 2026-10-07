import { describe, expect, it } from "vitest";
import { activeAfterRemoval, listKeyAction } from "@/lib/search/suggest-keys";
import { buildSuggestions, flattenGroups } from "@/lib/search/suggest-rows";

const recentRows = flattenGroups(buildSuggestions({ q: "", data: null, recent: ["ssd", "tai nghe"] }).groups);
const queryRows = flattenGroups(
  buildSuggestions({
    q: "ssd",
    data: { q: "ssd", products: [], brands: [{ name: "WD", href: "/brand/wd" }], categories: [], intent: [] },
    recent: [],
  }).groups,
);
const key = (k: string, active: number, rows = recentRows, listVisible = true, composing = false) =>
  listKeyAction({ key: k, composing, listVisible, rows, active });

describe("listKeyAction", () => {
  it("arrows walk every row and wrap, including the clear-history row", () => {
    expect(recentRows.map((r) => r.kind)).toEqual(["recent", "recent", "clear-recent"]);
    expect(key("ArrowDown", -1)).toEqual({ type: "move", to: 0 });
    expect(key("ArrowDown", 2)).toEqual({ type: "move", to: 0 });
    expect(key("ArrowUp", -1)).toEqual({ type: "move", to: 2 });
    expect(key("ArrowUp", 0)).toEqual({ type: "move", to: 2 });
    expect(key("ArrowUp", 2)).toEqual({ type: "move", to: 1 });
  });

  it("ArrowDown on a closed list opens it; other keys are left alone", () => {
    expect(key("ArrowDown", -1, recentRows, false)).toEqual({ type: "open" });
    expect(key("ArrowDown", -1, [], false)).toBeNull();
    expect(key("Enter", 0, recentRows, false)).toBeNull();
    expect(key("Delete", 0, recentRows, false)).toBeNull();
  });

  it("Enter picks the active row; without one the form submits natively", () => {
    expect(key("Enter", 0)).toEqual({ type: "pick", row: recentRows[0] });
    expect(key("Enter", -1)).toBeNull();
  });

  it("Enter on 'Xóa lịch sử' picks the clear-history row (keyboard clear-all)", () => {
    expect(key("Enter", 2)).toEqual({ type: "pick", row: { kind: "clear-recent", href: null } });
  });

  it("Delete or Backspace on an active recent row removes it", () => {
    expect(key("Delete", 1)).toEqual({ type: "remove", q: "tai nghe", index: 1 });
    expect(key("Backspace", 0)).toEqual({ type: "remove", q: "ssd", index: 0 });
  });

  it("Delete / Backspace elsewhere is not intercepted (typed text and other rows stay)", () => {
    expect(key("Delete", -1)).toBeNull();
    expect(key("Delete", 2)).toBeNull();
    expect(key("Backspace", 0, queryRows)).toBeNull();
    expect(key("Delete", 1, queryRows)).toBeNull();
  });

  it("Tab closes the list and lets focus move on", () => {
    expect(key("Tab", 0)).toEqual({ type: "close" });
  });

  it("ignores every key during an IME composition", () => {
    for (const k of ["ArrowDown", "Enter", "Delete", "Backspace", "Tab"]) expect(key(k, 0, recentRows, true, true)).toBeNull();
  });

  it("an out-of-range active index counts as none", () => {
    expect(key("Enter", 9)).toBeNull();
    expect(key("ArrowDown", 9)).toEqual({ type: "move", to: 0 });
  });
});

describe("activeAfterRemoval", () => {
  it("stays on the row that took the removed one's place, else the new last one, else none", () => {
    expect(activeAfterRemoval(0, 2)).toBe(0);
    expect(activeAfterRemoval(2, 2)).toBe(1);
    expect(activeAfterRemoval(0, 0)).toBe(-1);
  });
});
