import { describe, expect, it } from "vitest";
import { normalizeVoucher, normalizeVouchers } from "@/lib/vouchers/normalize";

const SELLER = "11111111-1111-4111-8111-111111111111";
const LISTING = "22222222-2222-4222-8222-222222222222";
const scope = { marketplace: "shopee", listingId: LISTING, sellerId: SELLER };
const base = { kind: "platform", discountType: "amount", discountValue: 30_000 };

describe("normalizeVoucher", () => {
  it("fills defaults and binds marketplace from the trusted scope", () => {
    expect(normalizeVoucher(base, scope)).toEqual({
      marketplace: "shopee",
      kind: "platform",
      sellerId: null,
      listingId: null,
      code: null,
      discountType: "amount",
      discountValue: 30_000,
      maxDiscount: null,
      minSpend: 0,
      startsAt: null,
      expiresAt: null,
    });
  });

  it("shop vouchers take the seller from the scope; listingOnly ties them to the listing", () => {
    expect(normalizeVoucher({ ...base, kind: "shop", sellerId: "ignored" }, scope)).toMatchObject({ sellerId: SELLER, listingId: null });
    expect(normalizeVoucher({ ...base, kind: "shop", listingOnly: true }, scope)).toMatchObject({ sellerId: SELLER, listingId: LISTING });
    // Platform vouchers never carry a seller.
    expect(normalizeVoucher({ ...base, kind: "platform" }, scope)).toMatchObject({ sellerId: null });
  });

  it("a shop voucher without a seller is rejected", () => {
    expect(normalizeVoucher({ ...base, kind: "shop" }, { ...scope, sellerId: null })).toBeNull();
    expect(normalizeVoucher({ ...base, kind: "shop", marketplace: "shopee" })).toBeNull();
  });

  it("upper-cases a code and checks its format", () => {
    expect(normalizeVoucher({ ...base, code: " shopx50 " }, scope)?.code).toBe("SHOPX50");
    expect(normalizeVoucher({ ...base, code: "" }, scope)?.code).toBeNull();
    expect(normalizeVoucher({ ...base, code: "AB" }, scope)).toBeNull();
    expect(normalizeVoucher({ ...base, code: "BAD-CODE" }, scope)).toBeNull();
    expect(normalizeVoucher({ ...base, code: "A".repeat(21) }, scope)).toBeNull();
    expect(normalizeVoucher({ ...base, code: 123 }, scope)).toBeNull();
  });

  it.each([
    ["not an object", "x"],
    ["unknown kind", { ...base, kind: "cashback" }],
    ["unknown discount type", { ...base, discountType: "coins" }],
    ["zero value", { ...base, discountValue: 0 }],
    ["negative value", { ...base, discountValue: -5 }],
    ["string value", { ...base, discountValue: "30000" }],
    ["NaN value", { ...base, discountValue: NaN }],
    ["value over 10 billion", { ...base, discountValue: 10_000_000_001 }],
    ["percent over 100", { ...base, discountType: "percent", discountValue: 101 }],
    ["bad max discount", { ...base, discountType: "percent", discountValue: 10, maxDiscount: 0 }],
    ["negative min spend", { ...base, minSpend: -1 }],
    ["unparseable expiry", { ...base, expiresAt: "soon" }],
    ["expiry before start", { ...base, startsAt: "2026-10-02T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" }],
    ["absurd date", { ...base, expiresAt: "1990-01-01T00:00:00Z" }],
  ])("rejects %s", (_label, raw) => {
    expect(normalizeVoucher(raw, scope)).toBeNull();
  });

  it("accepts the boundaries: 100%, 10 billion, zero min spend", () => {
    expect(normalizeVoucher({ ...base, discountType: "percent", discountValue: 100 }, scope)).not.toBeNull();
    expect(normalizeVoucher({ ...base, discountValue: 10_000_000_000 }, scope)).not.toBeNull();
    expect(normalizeVoucher({ ...base, minSpend: 0 }, scope)?.minSpend).toBe(0);
  });

  it("drops the cap of an amount voucher and normalizes dates to ISO", () => {
    const v = normalizeVoucher({ ...base, maxDiscount: 5_000, expiresAt: Date.UTC(2026, 9, 1) }, scope);
    expect(v).toMatchObject({ maxDiscount: null, expiresAt: "2026-10-01T00:00:00.000Z" });
  });

  it("without a scope, accepts only well-formed ids", () => {
    expect(normalizeVoucher({ ...base, marketplace: "shopee", listingId: LISTING })).toMatchObject({ listingId: LISTING });
    expect(normalizeVoucher({ ...base, marketplace: "shopee", listingId: "x'; drop" })).toMatchObject({ listingId: null });
    expect(normalizeVoucher({ ...base, marketplace: "Shop ee" })).toBeNull();
  });
});

describe("normalizeVouchers", () => {
  it("drops invalid entries and duplicates, and caps the input", () => {
    const list = [base, base, { ...base, discountValue: 0 }, { ...base, discountValue: 40_000 }];
    expect(normalizeVouchers(list, scope, 20).map((v) => v.discountValue)).toEqual([30_000, 40_000]);
    expect(normalizeVouchers(list, scope, 1)).toHaveLength(1);
    expect(normalizeVouchers("nope", scope, 20)).toEqual([]);
  });
});
