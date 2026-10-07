import { describe, expect, it } from "vitest";
import { foldText, highlightParts } from "@/lib/search/highlight";

const marked = (text: string, q: string) =>
  highlightParts(text, q)
    .map((p) => (p.match ? `[${p.text}]` : p.text))
    .join("");

describe("foldText", () => {
  it("lowercases and strips Vietnamese accents, including đ", () => {
    expect(foldText("Tai Nghe Đồng Hồ Ổ Cứng")).toBe("tai nghe dong ho o cung");
  });
});

describe("highlightParts", () => {
  it("matches without accents and keeps the original spelling", () => {
    expect(marked("Tai nghe Sony WH-1000XM5", "tai nghe")).toBe("[Tai] [nghe] Sony WH-1000XM5");
  });

  it("matches an accented query against accented text", () => {
    expect(marked("Nồi chiên không dầu", "noi chien")).toBe("[Nồi] [chiên] không dầu");
    expect(marked("Nồi chiên không dầu", "nồi")).toBe("[Nồi] chiên không dầu");
  });

  it("only matches at the start of a word (the search is prefix-based)", () => {
    expect(marked("Mountain bike", "tai")).toBe("Mountain bike");
    expect(marked("Samsung 990 Pro", "sam")).toBe("[Sam]sung 990 Pro");
  });

  it("highlights every occurrence and merges overlapping or touching matches", () => {
    expect(marked("SSD ssd", "ssd")).toBe("[SSD] [ssd]");
    expect(marked("kingston", "king kingston")).toBe("[kingston]");
  });

  it("ignores one-character tokens unless they are the whole query", () => {
    expect(marked("SSD 3 TB", "ssd 3")).toBe("[SSD] 3 TB");
    expect(marked("3 TB", "3")).toBe("[3] TB");
  });

  it("handles text stored in decomposed (NFD) form", () => {
    const nfd = "Nồi chiên".normalize("NFD");
    const parts = highlightParts(nfd, "noi");
    expect(parts[0]).toEqual({ text: "Nồi".normalize("NFD"), match: true });
    expect(parts.map((p) => p.text).join("")).toBe(nfd);
  });

  it("returns the whole text unmarked for an empty or punctuation-only query", () => {
    expect(highlightParts("Tai nghe", "")).toEqual([{ text: "Tai nghe", match: false }]);
    expect(highlightParts("Tai nghe", "  -- ")).toEqual([{ text: "Tai nghe", match: false }]);
    expect(highlightParts("", "tai")).toEqual([]);
  });

  it("treats regex characters in the query literally", () => {
    expect(marked("C++ (2024)", "c++")).toBe("[C]++ (2024)");
    expect(marked("a.b", ".*")).toBe("a.b");
  });
});
