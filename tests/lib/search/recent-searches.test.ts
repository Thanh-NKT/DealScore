import { describe, expect, it } from "vitest";
import { RECENT_KEY, RECENT_MAX, addRecent, clearRecent, readRecent, removeRecent, type StorageLike } from "@/lib/search/recent-searches";

function memory(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("recent searches", () => {
  it("adds newest first and survives a re-read (reload)", () => {
    const s = memory();
    addRecent("ssd 2tb", s);
    addRecent("tai nghe", s);
    expect(readRecent(s)).toEqual(["tai nghe", "ssd 2tb"]);
    expect(JSON.parse(s.data.get(RECENT_KEY)!)).toEqual(["tai nghe", "ssd 2tb"]);
  });

  it("keeps at most 5", () => {
    const s = memory();
    for (const q of ["a1", "a2", "a3", "a4", "a5", "a6", "a7"]) addRecent(q, s);
    expect(RECENT_MAX).toBe(5);
    expect(readRecent(s)).toEqual(["a7", "a6", "a5", "a4", "a3"]);
  });

  it("dedupes without accents or case, moving the query to the front with the newest spelling", () => {
    const s = memory();
    addRecent("Tai nghe", s);
    addRecent("ssd", s);
    expect(addRecent("tai  nghé ", s)).toEqual(["tai nghé", "ssd"]);
  });

  it("ignores blank queries and trims long ones to 100 characters", () => {
    const s = memory();
    expect(addRecent("   ", s)).toEqual([]);
    expect(addRecent("x".repeat(150), s)[0]).toHaveLength(100);
  });

  it("removes one entry (accent-insensitive) and clears all", () => {
    const s = memory();
    addRecent("nồi chiên", s);
    addRecent("ssd", s);
    expect(removeRecent("noi chien", s)).toEqual(["ssd"]);
    expect(clearRecent(s)).toEqual([]);
    expect(s.data.has(RECENT_KEY)).toBe(false);
  });

  it("treats corrupt or foreign data as empty and drops bad entries", () => {
    expect(readRecent(memory("{not json"))).toEqual([]);
    expect(readRecent(memory('{"a":1}'))).toEqual([]);
    expect(readRecent(memory('["ssd", 3, null, "", "SSD", "tai nghe"]'))).toEqual(["ssd", "tai nghe"]);
  });

  it("never throws when storage is broken or missing", () => {
    expect(readRecent(broken)).toEqual([]);
    expect(addRecent("ssd", broken)).toEqual(["ssd"]);
    expect(removeRecent("ssd", broken)).toEqual([]);
    expect(clearRecent(broken)).toEqual([]);
    expect(readRecent(null)).toEqual([]);
    expect(addRecent("ssd", null)).toEqual(["ssd"]);
  });

  it("a full quota (setItem throws, getItem works) loses nothing on screen when the shown list is passed", () => {
    const s = memory('["old"]');
    s.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    let shown = readRecent(s);
    shown = addRecent("ssd", s, shown);
    shown = addRecent("tai nghe", s, shown);
    expect(shown).toEqual(["tai nghe", "ssd", "old"]);
    expect(removeRecent("ssd", s, shown)).toEqual(["tai nghe", "old"]);
  });

  it("an empty shown list falls back to storage (never wipes the stored history)", () => {
    const s = memory('["old", "ssd"]');
    expect(addRecent("loa", s, [])).toEqual(["loa", "old", "ssd"]);
    expect(removeRecent("old", s, [])).toEqual(["loa", "ssd"]);
  });
});
