import { describe, expect, it } from "vitest";
import { comparableUnitPrices, parseUnitQuantity, unitPrice, variantUnitQuantity } from "@/lib/pricing/unit-price";

describe("parseUnitQuantity", () => {
  it.each([
    ["Tã quần size L 48 miếng", { kind: "count", total: 48, perPack: 48, packs: 1 }],
    ["Sữa 180ml x 48", { kind: "volume", total: 8640, perPack: 180, packs: 48 }],
    ["Thùng 48 hộp 180ml", { kind: "volume", total: 8640, perPack: 180, packs: 48 }],
    ["48 x 180ml", { kind: "volume", total: 8640, perPack: 180, packs: 48 }],
    ["1,5L", { kind: "volume", total: 1500, perPack: 1500, packs: 1 }],
    ["1.5 lít", { kind: "volume", total: 1500, perPack: 1500, packs: 1 }],
    ["500g", { kind: "mass", total: 500, perPack: 500, packs: 1 }],
    ["1kg", { kind: "mass", total: 1000, perPack: 1000, packs: 1 }],
    ["10 gói 20g", { kind: "mass", total: 200, perPack: 20, packs: 10 }],
    ["Lốc 4 hộp 110ml", { kind: "volume", total: 440, perPack: 110, packs: 4 }],
  ])("%s", (text, q) => {
    expect(parseUnitQuantity(text)).toEqual(q);
  });

  it.each(["2TB", "16GB", "20000mAh", "Bàn phím 104 phím", "1 chiếc", "180ml / 110ml", "Sữa 180ml x 49", "500g 1L", "", "Màu đen"])(
    "%s → null",
    (text) => {
      expect(parseUnitQuantity(text)).toBeNull();
    },
  );
});

describe("unitPrice", () => {
  it("per 100 from 100 ml, per ml below; per piece for counts; whole đồng", () => {
    expect(unitPrice(459_000, parseUnitQuantity("1L"))).toEqual({ value: 45_900, per: 100, unit: "ml", label: "45.900 đ/100 ml" });
    expect(unitPrice(9_000, parseUnitQuantity("50ml"))).toEqual({ value: 180, per: 1, unit: "ml", label: "180 đ/ml" });
    expect(unitPrice(149_760, parseUnitQuantity("48 miếng"))).toMatchObject({ value: 3_120, label: "3.120 đ/miếng" });
    expect(unitPrice(null, parseUnitQuantity("48 miếng"))).toBeNull();
    expect(unitPrice(100, null)).toBeNull();
  });
});

describe("variantUnitQuantity", () => {
  it("reads variant key + specs; product name only for a single-variant product", () => {
    expect(variantUnitQuantity({ variantKey: "Size L", specs: { "Số lượng": "48 miếng" } })?.total).toBe(48);
    expect(variantUnitQuantity({ variantKey: "Mặc định" }, { canonicalName: "Sữa tươi 180ml x 48", variantCount: 1 })?.total).toBe(8640);
    expect(variantUnitQuantity({ variantKey: "Mặc định" }, { canonicalName: "Sữa tươi 180ml x 48", variantCount: 2 })).toBeNull();
    expect(variantUnitQuantity({ variantKey: "2TB" }, { canonicalName: "SSD 2TB 500g", variantCount: 1 })).toBeNull();
  });
});

describe("comparableUnitPrices", () => {
  it("≥ 2 rows with the same unit and base", () => {
    const a = unitPrice(100_000, parseUnitQuantity("48 miếng"));
    const b = unitPrice(150_000, parseUnitQuantity("96 miếng"));
    const c = unitPrice(150_000, parseUnitQuantity("1L"));
    expect(comparableUnitPrices([a, b], (x) => x)).toBe(true);
    expect(comparableUnitPrices([a, c], (x) => x)).toBe(false);
    expect(comparableUnitPrices([a, null], (x) => x)).toBe(false);
  });
});
