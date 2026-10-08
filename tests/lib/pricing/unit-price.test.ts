import { describe, expect, it } from "vitest";
import {
  comparableUnitPrices,
  isUnitPriceCategory,
  parseUnitQuantity,
  UNIT_PRICE_CATEGORY_SLUGS,
  unitPrice,
  variantUnitQuantity,
} from "@/lib/pricing/unit-price";

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
    // m4: a dot before exactly three digits is a thousands separator.
    ["Can 3.000ml", { kind: "volume", total: 3000, perPack: 3000, packs: 1 }],
    // A small mass next to a pack count is still a sachet, not a network generation.
    ["10 gói 5g", { kind: "mass", total: 50, perPack: 5, packs: 10 }],
  ])("%s", (text, q) => {
    expect(parseUnitQuantity(text)).toEqual(q);
  });

  it.each([
    "2TB", "16GB", "20000mAh", "Bàn phím 104 phím", "1 chiếc", "180ml / 110ml", "Sữa 180ml x 49", "500g 1L", "", "Màu đen",
    // P4 review I3: network generations are not grams.
    "Galaxy A55 5G", "Samsung Galaxy A55 5G 8GB/128GB", "Router 4G LTE", "Bộ phát wifi 4G", "iPhone 3G", "5G",
    // Appliance capacities are not consumable quantities.
    "Nồi chiên không dầu Philips 4.1L", "Nồi cơm điện 1.8L", "Ấm siêu tốc 1.7L", "Máy xay sinh tố 1.5L",
    "Máy hút bụi 2.5kg", "Bình giữ nhiệt 500ml", "Máy giặt 9kg", "Tủ lạnh 180L",
  ])(
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
  const sua = (canonicalName: string, variantCount: number) => ({ categorySlug: "sua", canonicalName, variantCount });
  it("reads variant key + specs; product name only for a single-variant product", () => {
    expect(variantUnitQuantity({ variantKey: "Size L", specs: { "Số lượng": "48 miếng" } }, { categorySlug: "ta-bim" })?.total).toBe(48);
    expect(variantUnitQuantity({ variantKey: "Mặc định" }, sua("Sữa tươi 180ml x 48", 1))?.total).toBe(8640);
    expect(variantUnitQuantity({ variantKey: "Mặc định" }, sua("Sữa tươi 180ml x 48", 2))).toBeNull();
    expect(variantUnitQuantity({ variantKey: "2TB" }, sua("SSD 2TB 500g", 1))).toBeNull();
  });
  it("P4 review I3: only consumable categories (allow-list) get a quantity", () => {
    expect(UNIT_PRICE_CATEGORY_SLUGS).toEqual(expect.arrayContaining(["ta-bim", "sua"]));
    expect(isUnitPriceCategory("sua")).toBe(true);
    expect(isUnitPriceCategory("ssd")).toBe(false);
    expect(isUnitPriceCategory(null)).toBe(false);
    // Multi-variant air fryer whose variant keys are capacities: no name to look at, the category decides.
    expect(variantUnitQuantity({ variantKey: "4.1L" }, { categorySlug: "noi-chien", canonicalName: "Nồi chiên", variantCount: 2 })).toBeNull();
    expect(variantUnitQuantity({ variantKey: "Mặc định" }, { categorySlug: "dien-thoai", canonicalName: "Galaxy A55 5G", variantCount: 1 })).toBeNull();
    expect(variantUnitQuantity({ variantKey: "48 miếng" }, { categorySlug: "san-pham" })).toBeNull();
    expect(variantUnitQuantity({ variantKey: "48 miếng" }, { categorySlug: undefined })).toBeNull();
    expect(variantUnitQuantity({ variantKey: "48 miếng" }, { categorySlug: "ta-bim" })?.total).toBe(48);
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
