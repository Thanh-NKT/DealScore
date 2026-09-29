/**
 * Effective price (spec 2026-09-28 §4): the item price after the best voucher combination, shipping
 * fee not included. Pure and DB-free; the math is select.ts — nothing is recomputed here.
 */
import { formatVnd } from "@/lib/format";
import type { VariantPricing } from "@/lib/pricing/variant-pricing";
import { activeVouchers, bestCombination, VOUCHER_FRESH_DAYS, type ActiveVoucherContext } from "@/lib/vouchers/select";
import type { Voucher } from "@/lib/vouchers/types";

/** A stored effective price older than this is not shown (same window as search_products v6). */
export const EFFECTIVE_FRESH_DAYS = VOUCHER_FRESH_DAYS;

/**
 * Price after the best combination of the vouchers that apply right now. Shipping vouchers give 0
 * (fee unknown). null when no voucher applies or nothing is taken off.
 */
export function effectivePriceFor(price: number, vouchers: readonly Voucher[], ctx: ActiveVoucherContext): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const active = activeVouchers(vouchers, ctx);
  if (active.length === 0) return null;
  const { estimatedTotal } = bestCombination(active, price, 0);
  return estimatedTotal < price ? estimatedTotal : null;
}

/** The stored value, when it is fresh and lower than `price`; otherwise null (nothing to show). */
export function shownEffectivePrice(
  effective: number | null | undefined,
  computedAt: string | null | undefined,
  price: number | null | undefined,
  now: Date,
): number | null {
  if (effective == null || !Number.isFinite(effective) || effective < 0) return null;
  if (price == null || !Number.isFinite(price) || !(effective < price)) return null;
  const at = computedAt ? Date.parse(computedAt) : Number.NaN;
  if (!Number.isFinite(at) || now.getTime() - at > EFFECTIVE_FRESH_DAYS * 86_400_000) return null;
  return effective;
}

export function effectiveReason(x: number): string {
  return `Dùng voucher: ước tính còn ${formatVnd(x)} (chưa gồm phí ship).`;
}

/**
 * Adds the voucher reason to the headline reasons when the best offer has a lower effective price.
 * The Deal Score itself is untouched (it scores the listed price). Skipped while the score is
 * insufficient: the breakdown then shows its "still collecting data" note instead of reasons.
 */
export function withEffectiveReason(pricing: VariantPricing): VariantPricing {
  const best = pricing.cheapest;
  const headline = pricing.headline;
  const x = best?.effectivePrice;
  if (!best || !headline || headline.score == null || x == null || best.price == null || !(x < best.price)) {
    return pricing;
  }
  return { ...pricing, headline: { ...headline, reasons: [...headline.reasons, effectiveReason(x)] } };
}
