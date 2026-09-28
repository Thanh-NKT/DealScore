import { describe, expect, it } from "vitest";
import { EMPTY_INTENT_TEXT_LIMIT, parseQueryIntent, type IntentVocab } from "@/lib/intent/parse";

const vocab: IntentVocab = {
  categories: [
    { slug: "ssd", name: "Ổ cứng SSD" }, { slug: "ban-phim", name: "Bàn phím" }, { slug: "chuot", name: "Chuột" },
    { slug: "man-hinh", name: "Màn hình" }, { slug: "tai-nghe", name: "Tai nghe" },
  ],
  brands: ["Samsung", "WD", "Logitech"],
};

describe("parseQueryIntent — chips", () => {
  it("labels and orders chips by appearance", () => {
    const r = parseQueryIntent("Samsung SSD 2TB dưới 3 triệu", vocab);
    expect(r.chips).toEqual([
      { kind: "brand", label: "Samsung" },
      { kind: "category", label: "Ổ cứng SSD" },
      { kind: "capacity", label: "2TB" },
      { kind: "price", label: "≤ 3.000.000đ" },
    ]);
  });

  it("min, range and around price labels", () => {
    expect(parseQueryIntent("ssd trên 2 triệu", vocab).chips).toContainEqual({ kind: "price", label: "≥ 2.000.000đ" });
    expect(parseQueryIntent("ssd tầm 1 triệu", vocab).chips).toContainEqual({
      kind: "price",
      label: "850.000đ – 1.150.000đ",
    });
  });

  it("capacity in GB when not a whole TB", () => {
    expect(parseQueryIntent("ssd 512gb", vocab).chips).toContainEqual({ kind: "capacity", label: "512GB" });
  });

  it("size, color, sort, flags and marketplace labels", () => {
    const r = parseQueryIntent("màn hình 27 inch màu đen rẻ nhất có voucher freeship trên shopee", vocab);
    expect(r.chips).toEqual([
      { kind: "category", label: "Màn hình" },
      { kind: "size", label: "27 inch" },
      { kind: "color", label: "Màu đen" },
      { kind: "sort", label: "Rẻ nhất" },
      { kind: "voucher", label: "Có voucher" },
      { kind: "free_shipping", label: "Freeship" },
      { kind: "marketplace", label: "Shopee" },
    ]);
    expect(r.text).toBe("");
  });

  it("deal_score and effective_asc sort labels", () => {
    expect(parseQueryIntent("ssd đáng mua", vocab).chips).toContainEqual({ kind: "sort", label: "Đáng mua nhất" });
    expect(parseQueryIntent("ssd sau voucher", vocab).chips).toContainEqual({ kind: "sort", label: "Rẻ nhất sau voucher" });
    expect(parseQueryIntent("tai nghe tiktok", vocab).chips).toContainEqual({ kind: "marketplace", label: "TikTok Shop" });
  });

  it("diacritics or not give the same intent", () => {
    const a = parseQueryIntent("bàn phím cơ không dây dưới 2 triệu", vocab);
    const b = parseQueryIntent("ban phim co khong day duoi 2 trieu", vocab);
    expect({ ...a, text: "" }).toEqual({ ...b, text: "" });
  });

  it("keeps original words in text", () => {
    expect(parseQueryIntent("SSD Samsung 990 Pro Bản Quốc Tế", vocab).text).toBe("990 Pro Bản Quốc Tế");
  });

  it("does not treat bare numbers as prices", () => {
    const r = parseQueryIntent("Samsung 990 Pro", vocab);
    expect(r.minPrice).toBeUndefined();
    expect(r.maxPrice).toBeUndefined();
  });

  it("separates price symbols glued to words", () => {
    expect(parseQueryIntent("ssd<3tr", vocab)).toMatchObject({ categorySlug: "ssd", maxPrice: 3_000_000, text: "" });
  });

  it("does not set fields it did not extract", () => {
    expect(parseQueryIntent("Pro", vocab)).toEqual({ text: "Pro", boostTerms: [], chips: [] });
  });
});

describe("parseQueryIntent — robustness", () => {
  it("truncates input to 200 chars", () => {
    expect(EMPTY_INTENT_TEXT_LIMIT).toBe(200);
    expect(parseQueryIntent("a".repeat(250), vocab).text).toBe("a".repeat(200));
    const tail = parseQueryIntent(`ssd ${"x".repeat(250)} dưới 3 triệu`, vocab);
    expect(tail.maxPrice).toBeUndefined();
    expect(tail.categorySlug).toBe("ssd");
  });

  it.each(["<<<>>>", "🔥🔥 ssd 🔥", "~~~", "-", "   ", "\u0000́", "đ", "1tb-2tb", "tu den", "0k"])(
    "never throws on %j",
    (junk) => {
      expect(() => parseQueryIntent(junk, vocab)).not.toThrow();
    },
  );

  it("never throws on non-string input", () => {
    expect(parseQueryIntent(undefined as unknown as string, vocab)).toEqual({ text: "", boostTerms: [], chips: [] });
    expect(() => parseQueryIntent("ssd", undefined as unknown as IntentVocab)).not.toThrow();
  });

  it("whitespace only → empty intent", () => {
    expect(parseQueryIntent("   ", vocab)).toEqual({ text: "", boostTerms: [], chips: [] });
  });

  it("ignores category synonyms whose slug is not in vocab", () => {
    const noSsd: IntentVocab = { categories: vocab.categories.filter((c) => c.slug !== "ssd"), brands: [] };
    const r = parseQueryIntent("ổ cứng 1tb", noSsd);
    expect(r.categorySlug).toBeUndefined();
    expect(r.capacityGb).toBe(1024);
    expect(r.text).toBe("ổ cứng");
  });

  it("ambiguous capacity is not extracted", () => {
    const r = parseQueryIntent("ssd 1tb 2tb", vocab);
    expect(r.capacityGb).toBeUndefined();
    expect(r.text).toBe("1tb 2tb");
  });
});
