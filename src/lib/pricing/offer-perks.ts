import type { OfferRow } from "@/lib/pricing/variant-pricing";
import type { Voucher } from "@/lib/vouchers/types";

/**
 * Pure. Perk chips of a seller row on the product page (roadmap P1 item 7), only from data: offers.free_shipping /
 * has_voucher and the listing's active vouchers. Never an amount (the price column already has "~X sau mã").
 * Display only: buildVariantPricing / Deal Score never read these fields.
 */

export type OfferPerkKind = "flash" | "freeship" | "voucher";
export interface OfferPerk {
  kind: OfferPerkKind;
  label: string;
}

/** `vouchers` must already be the listing's activeVouchers (expiry is not re-checked here). */
export function offerPerks(
  offer: Pick<OfferRow, "isFlashSale" | "freeShipping" | "hasVoucher">,
  vouchers: readonly Voucher[],
): OfferPerk[] {
  const perks: OfferPerk[] = [];
  if (offer.isFlashSale) perks.push({ kind: "flash", label: "Flash sale" });
  if (offer.freeShipping === true || vouchers.some((v) => v.kind === "shipping")) {
    perks.push({ kind: "freeship", label: "Freeship" });
  }
  // Payment vouchers depend on the payment method: no chip.
  if (offer.hasVoucher === true || vouchers.some((v) => v.kind === "shop" || v.kind === "platform")) {
    perks.push({ kind: "voucher", label: "Có mã giảm giá" });
  }
  return perks;
}
