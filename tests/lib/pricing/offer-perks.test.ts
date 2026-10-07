import { describe, expect, it } from "vitest";
import { offerPerks } from "@/lib/pricing/offer-perks";
import type { Voucher, VoucherKind } from "@/lib/vouchers/types";

const voucher = (kind: VoucherKind): Voucher => ({
  id: `v-${kind}`, marketplace: "shopee", kind, sellerId: null, listingId: null, code: null, discountType: "amount",
  discountValue: 10_000, maxDiscount: null, minSpend: 0, startsAt: null, expiresAt: null, source: "api", reporters: [],
  firstSeenAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-07T00:00:00Z",
});
const offer = (o: Partial<{ isFlashSale: boolean; freeShipping: boolean | null; hasVoucher: boolean | null }> = {}) => ({
  isFlashSale: false, freeShipping: null, hasVoucher: null, ...o,
});
const kinds = (p: ReturnType<typeof offerPerks>) => p.map((x) => x.kind);

describe("offerPerks", () => {
  it("free_shipping alone → Freeship", () => {
    expect(offerPerks(offer({ freeShipping: true }), [])).toEqual([{ kind: "freeship", label: "Freeship" }]);
  });
  it("an active shipping voucher → Freeship", () => {
    expect(kinds(offerPerks(offer(), [voucher("shipping")]))).toEqual(["freeship"]);
  });
  it("shop / platform voucher or has_voucher → Có mã giảm giá", () => {
    expect(offerPerks(offer(), [voucher("shop")])).toEqual([{ kind: "voucher", label: "Có mã giảm giá" }]);
    expect(kinds(offerPerks(offer(), [voucher("platform")]))).toEqual(["voucher"]);
    expect(kinds(offerPerks(offer({ hasVoucher: true }), []))).toEqual(["voucher"]);
  });
  it("payment vouchers make no chip", () => {
    expect(offerPerks(offer(), [voucher("payment")])).toEqual([]);
  });
  it("flash → freeship → voucher, each once", () => {
    const p = offerPerks(offer({ isFlashSale: true, freeShipping: true, hasVoucher: true }),
      [voucher("shipping"), voucher("shop"), voucher("platform")]);
    expect(p).toEqual([
      { kind: "flash", label: "Flash sale" }, { kind: "freeship", label: "Freeship" }, { kind: "voucher", label: "Có mã giảm giá" },
    ]);
  });
  it("false / null → nothing", () => {
    expect(offerPerks(offer({ freeShipping: false, hasVoucher: false }), [])).toEqual([]);
    expect(offerPerks(offer(), [])).toEqual([]);
  });
});
