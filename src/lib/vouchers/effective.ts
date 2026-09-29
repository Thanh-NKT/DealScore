/**
 * Effective price (spec 2026-09-28 §4): the item price after the best voucher combination, shipping
 * fee not included. Pure and DB-free; the math is select.ts — nothing is recomputed here.
 */
import { formatVnd } from "@/lib/format";
import { marketplaceName as getMarketplaceName } from "@/lib/marketplaces";
import type { VariantPricing } from "@/lib/pricing/variant-pricing";
import { activeVouchers, bestCombination, VOUCHER_FRESH_DAYS, type ActiveVoucherContext } from "@/lib/vouchers/select";
import type { Voucher } from "@/lib/vouchers/types";

/** A stored effective price older than this is not shown (same window as search_products). */
export const EFFECTIVE_FRESH_DAYS = VOUCHER_FRESH_DAYS;

export interface EffectiveQuote {
  /** Price after the best voucher combination (shipping excluded). */
  price: number;
  /** Earliest expiry among the vouchers of that combination; null when none of them expires. */
  until: string | null;
}

/**
 * Price after the best combination of the vouchers that apply right now, plus when that combination
 * stops being valid. Shipping vouchers give 0 (fee unknown). null when no voucher applies or nothing
 * is taken off.
 */
export function effectiveQuoteFor(price: number, vouchers: readonly Voucher[], ctx: ActiveVoucherContext): EffectiveQuote | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const active = activeVouchers(vouchers, ctx);
  if (active.length === 0) return null;
  const { picks, estimatedTotal } = bestCombination(active, price, 0);
  if (!(estimatedTotal < price)) return null;
  let until: string | null = null;
  for (const { voucher, amount } of picks) {
    if (amount <= 0 || !voucher.expiresAt) continue;
    if (until == null || Date.parse(voucher.expiresAt) < Date.parse(until)) until = voucher.expiresAt;
  }
  return { price: estimatedTotal, until };
}

/** effectiveQuoteFor()'s price only. */
export function effectivePriceFor(price: number, vouchers: readonly Voucher[], ctx: ActiveVoucherContext): number | null {
  return effectiveQuoteFor(price, vouchers, ctx)?.price ?? null;
}

/** offers.effective_price / _at / _until as read from the DB. */
export interface StoredEffective {
  price: number | null | undefined;
  at: string | null | undefined;
  until: string | null | undefined;
}

/** The offer's current (latest valid) observation. */
export interface CurrentObservation {
  price: number | null | undefined;
  observedAt: string | null | undefined;
}

/**
 * The stored value, or null (nothing to show). Same guards as search_products (0016): lower than the
 * current price, computed from the current observation or a later one (`at >= observedAt`; a newer
 * observation means the price changed since), computed within EFFECTIVE_FRESH_DAYS, and no voucher
 * of the combination expired (`until` null or in the future).
 */
export function shownEffectivePrice(stored: StoredEffective, current: CurrentObservation, now: Date): number | null {
  const effective = stored.price;
  const price = current.price;
  if (effective == null || !Number.isFinite(effective) || effective < 0) return null;
  if (price == null || !Number.isFinite(price) || !(effective < price)) return null;
  const at = stored.at ? Date.parse(stored.at) : Number.NaN;
  if (!Number.isFinite(at) || now.getTime() - at > EFFECTIVE_FRESH_DAYS * 86_400_000) return null;
  const observedAt = current.observedAt ? Date.parse(current.observedAt) : Number.NaN;
  if (!Number.isFinite(observedAt) || at < observedAt) return null;
  if (stored.until != null) {
    const until = Date.parse(stored.until);
    if (!Number.isFinite(until) || until <= now.getTime()) return null;
  }
  return effective;
}

/** `marketplaceName` is given only when the voucher moves the best buy to another marketplace. */
export function effectiveReason(x: number, marketplaceName?: string): string {
  const where = marketplaceName ? ` trên ${marketplaceName}` : "";
  return `Dùng voucher${where}: ước tính còn ${formatVnd(x)} (chưa gồm phí ship).`;
}

/**
 * Adds the voucher reason to the headline reasons when the best buy (pickBestBuy) has a lower
 * effective price — also while the Deal Score is insufficient (spec §4; the breakdown then shows its
 * "still collecting data" note plus these reasons). The Deal Score itself is untouched (it scores the
 * listed price). The reason names the marketplace when it differs from the cheapest listed one.
 */
export function withEffectiveReason(pricing: VariantPricing): VariantPricing {
  const best = pricing.bestBuy;
  const headline = pricing.headline;
  const x = best?.effectivePrice;
  if (!best || !headline || x == null || best.price == null || !(x < best.price)) {
    return pricing;
  }
  const moved = pricing.cheapest != null && pricing.cheapest.marketplace !== best.marketplace;
  const reason = effectiveReason(x, moved ? getMarketplaceName(best.marketplace) : undefined);
  return { ...pricing, headline: { ...headline, reasons: [...headline.reasons, reason] } };
}
