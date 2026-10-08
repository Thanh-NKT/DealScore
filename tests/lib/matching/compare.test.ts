import { describe, expect, it } from "vitest";
import { compareAttributes } from "@/lib/matching/compare";
import { scoreCandidate, SUGGEST_THRESHOLD, type MatchCandidate, type OfferToMatch } from "@/lib/matching/match";
import { CATALOG, LABELED } from "./fixtures";

const BRANDS = ["Samsung", "Western Digital", "WD", "Logitech", "Sony", "Dell", "Kingston", "Apple", "LG"];

function candidate(over: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    variantId: "v-2tb", productId: "p-990", brand: "Samsung", model: "990 Pro", canonicalName: "SSD Samsung 990 Pro",
    variantKey: "dung-luong=2TB", variantSpecs: {}, siblingCount: 2, ...over,
  };
}
const byKey = (rows: ReturnType<typeof compareAttributes>) => Object.fromEntries(rows.map((r) => [r.key, r]));

describe("compareAttributes", () => {
  it("returns the five rows in order, with Vietnamese labels", () => {
    const rows = compareAttributes({ title: "SSD Samsung 990 PRO NVMe", modelName: "2TB" }, candidate(), BRANDS);
    expect(rows.map((r) => r.key)).toEqual(["brand", "model", "capacityGb", "color", "sizeInch"]);
    expect(rows.map((r) => r.label)).toEqual(["Thương hiệu", "Model", "Dung lượng", "Màu", "Kích thước"]);
    expect(byKey(rows)).toMatchObject({
      brand: { offer: "Samsung", catalog: "Samsung", state: "match" },
      model: { offer: "990 Pro", catalog: "990 Pro", state: "match" },
      capacityGb: { offer: "2TB", catalog: "2TB", state: "match" },
      color: { offer: null, catalog: null, state: "unknown" },
      sizeInch: { state: "unknown" },
    });
  });

  it('"990 PRO" against model "990" is a longer model name → mismatch', () => {
    const r = byKey(compareAttributes({ title: "Samsung 990 PRO 1TB", modelName: "" }, candidate({ model: "990", variantKey: "1TB" }), BRANDS));
    expect(r.model).toMatchObject({ state: "mismatch", offer: "Tên model dài hơn", catalog: "990" });
  });

  it('"S24+" against model "S24" → mismatch', () => {
    const r = byKey(compareAttributes({ title: "Samsung Galaxy S24+ 256GB", modelName: "" }, candidate({ model: "S24", variantKey: "256GB" }), BRANDS));
    expect(r.model.state).toBe("mismatch");
  });

  it("partial model coverage, and no model token at all", () => {
    const partial = byKey(compareAttributes({ title: "Kingston Fury DDR5", modelName: "16GB" }, candidate({ brand: "Kingston", model: "Fury Beast", variantKey: "16GB" }), BRANDS));
    expect(partial.model).toMatchObject({ state: "mismatch", offer: "Khớp 1/2 phần" });
    const none = byKey(compareAttributes({ title: "Kingston DDR5", modelName: "16GB" }, candidate({ brand: "Kingston", model: "Fury Beast", variantKey: "16GB" }), BRANDS));
    expect(none.model).toMatchObject({ state: "unknown", offer: null });
    const noModel = byKey(compareAttributes({ title: "Samsung SSD", modelName: "" }, candidate({ model: null }), BRANDS));
    expect(noModel.model).toMatchObject({ state: "unknown", catalog: null });
  });

  it("a colour on one side only is unknown; Đen vs black is a match", () => {
    const one = byKey(compareAttributes({ title: "Logitech G304", modelName: "" }, candidate({ brand: "Logitech", model: "G304", variantKey: "mau=Đen" }), BRANDS));
    expect(one.color).toMatchObject({ state: "unknown", offer: null });
    expect(one.color.catalog).not.toBeNull();
    const same = byKey(compareAttributes({ title: "Logitech G304 Black", modelName: "" }, candidate({ brand: "Logitech", model: "G304", variantKey: "mau=Đen" }), BRANDS));
    expect(same.color.state).toBe("match");
    const other = byKey(compareAttributes({ title: "Logitech G304", modelName: "Trắng" }, candidate({ brand: "Logitech", model: "G304", variantKey: "mau=Đen" }), BRANDS));
    expect(other.color.state).toBe("mismatch");
  });

  it("another brand in the title is a mismatch; no brand is unknown; a candidate without a brand is unknown", () => {
    expect(byKey(compareAttributes({ title: "WD Black 990 Pro 2TB", modelName: "" }, candidate(), BRANDS)).brand)
      .toMatchObject({ state: "mismatch", offer: "WD", catalog: "Samsung" });
    expect(byKey(compareAttributes({ title: "SSD 990 Pro 2TB", modelName: "" }, candidate(), BRANDS)).brand)
      .toMatchObject({ state: "unknown", offer: null });
    expect(byKey(compareAttributes({ title: "Samsung 990 Pro", modelName: "" }, candidate({ brand: null }), BRANDS)).brand.state).toBe("unknown");
  });

  it("a brand alias in the title matches the catalog brand", () => {
    const r = byKey(compareAttributes({ title: "SSD WD_BLACK SN850X", modelName: "2TB" }, CATALOG.find((c) => c.variantId === "sn850x:2tb")!, BRANDS));
    expect(r.brand.state).toBe("match");
  });
});

// The table must never contradict the score: compareAttributes reuses scoreCandidate's own helpers.
describe("compareAttributes is consistent with scoreCandidate", () => {
  const offers: OfferToMatch[] = [
    ...LABELED.map((l) => ({ title: l.title, modelName: l.model, gtin: l.gtin })),
    { title: "Ổ cứng SSD Samsung 990 PRO NVMe", modelName: "2TB" },
    { title: "Samsung 990PRO 2TB", modelName: "" },
    { title: "WD Black 990 Pro 2TB", modelName: "2TB" },
    { title: "Samsung 990 Pro", modelName: "1TB" },
    { title: "Samsung 990 2TB", modelName: "" },
    { title: "Samsung SSD 2TB", modelName: "" },
    { title: "Samsung Galaxy S24+ 256GB", modelName: "" },
  ];
  const candidates: MatchCandidate[] = [...CATALOG, candidate(), candidate({ model: null }), candidate({ model: "S24", variantKey: "256GB" })];
  const pairs = offers.flatMap((o) => candidates.map((c) => ({ o, c })));

  it(`checks ${pairs.length} pairs`, () => {
    expect(pairs.length).toBeGreaterThan(500);
  });

  it("✕ on capacity / colour / size ⇒ confidence 0", () => {
    const bad = pairs.filter(({ o, c }) => {
      const rows = compareAttributes(o, c, BRANDS);
      const attrMismatch = rows.some((r) => ["capacityGb", "color", "sizeInch"].includes(r.key) && r.state === "mismatch");
      return attrMismatch && scoreCandidate(o, c).confidence !== 0;
    });
    expect(bad.map(({ o, c }) => `${o.title} [${o.modelName}] × ${c.variantId}`)).toEqual([]);
  });

  // Stronger than "every row ✓": brand and model ✓ and no ✕ anywhere (unknown attributes allowed).
  it("brand + model ✓ and no ✕ (so also: every row ✓) ⇒ confidence ≥ SUGGEST_THRESHOLD", () => {
    let allMatch = 0;
    const bad = pairs.filter(({ o, c }) => {
      if (!c.model) return false;
      const rows = compareAttributes(o, c, BRANDS);
      const ok = rows.every((r) => r.state !== "mismatch") && rows.slice(0, 2).every((r) => r.state === "match");
      if (!ok) return false;
      allMatch++;
      return scoreCandidate(o, c).confidence < SUGGEST_THRESHOLD;
    });
    expect(bad.map(({ o, c }) => `${o.title} [${o.modelName}] × ${c.variantId}`)).toEqual([]);
    expect(allMatch).toBeGreaterThan(0);
  });
});
