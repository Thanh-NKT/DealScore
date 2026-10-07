import { describe, expect, it } from "vitest";
import { matchVocab } from "@/lib/search/suggest-vocab";
import type { IntentVocab } from "@/lib/intent/types";

const vocab: IntentVocab = {
  categories: [
    { slug: "ssd", name: "Ổ cứng SSD" },
    { slug: "ban-phim", name: "Bàn phím" },
    { slug: "chuot", name: "Chuột" },
    { slug: "man-hinh", name: "Màn hình" },
    { slug: "tai-nghe", name: "Tai nghe" },
    { slug: "sac-du-phong", name: "Sạc dự phòng" },
  ],
  brands: ["Samsung", "Sony", "WD", "Logitech", "Sandisk", "Samsonite", "Salora"],
};

describe("matchVocab", () => {
  it("'sam' → Samsung by prefix", () => {
    const { brands } = matchVocab("sam", vocab);
    expect(brands[0]).toEqual({ name: "Samsung", href: "/brand/samsung" });
  });

  it("'tai ng' → category Tai nghe, href /{slug}", () => {
    const { categories } = matchVocab("tai ng", vocab);
    expect(categories).toEqual([{ name: "Tai nghe", slug: "tai-nghe", href: "/tai-nghe" }]);
  });

  it("matches without diacritics and with them ('o cung', 'Ổ cứng', 'sạc')", () => {
    expect(matchVocab("o cung", vocab).categories[0].slug).toBe("ssd");
    expect(matchVocab("Ổ cứng", vocab).categories[0].slug).toBe("ssd");
    expect(matchVocab("sạc", vocab).categories[0].slug).toBe("sac-du-phong");
  });

  it("a full query names both the category and the brand ('tai nghe sony')", () => {
    const res = matchVocab("tai nghe sony", vocab);
    expect(res.categories.map((c) => c.slug)).toEqual(["tai-nghe"]);
    expect(res.brands.map((b) => b.name)).toEqual(["Sony"]);
  });

  it("the word being typed completes a brand ('tai nghe so' → Sony)", () => {
    expect(matchVocab("tai nghe so", vocab).brands.map((b) => b.name)).toEqual(["Sony"]);
  });

  it("intent synonyms reach their category ('headphone' → Tai nghe, 'mouse' → Chuột)", () => {
    expect(matchVocab("headphone", vocab).categories[0].slug).toBe("tai-nghe");
    expect(matchVocab("mouse logitech", vocab).categories[0].slug).toBe("chuot");
  });

  it("brand aliases count ('western digital' → WD)", () => {
    expect(matchVocab("western digital", vocab).brands.map((b) => b.name)).toEqual(["WD"]);
  });

  it("at most 3 of each, exact before prefix", () => {
    const { brands } = matchVocab("sa", vocab);
    expect(brands).toHaveLength(3);
    expect(matchVocab("sony", vocab).brands[0].name).toBe("Sony");
  });

  it("nothing for a 1-letter query, empty vocab or unrelated text", () => {
    expect(matchVocab("s", vocab)).toEqual({ brands: [], categories: [] });
    expect(matchVocab("sam", { categories: [], brands: [] })).toEqual({ brands: [], categories: [] });
    expect(matchVocab("xyz 2tb", vocab)).toEqual({ brands: [], categories: [] });
  });

  it("a number alone never completes a name", () => {
    expect(matchVocab("ssd 2", vocab).brands).toEqual([]);
  });
});
