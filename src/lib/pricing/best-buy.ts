/**
 * "Where to buy": the offer that costs least once vouchers are applied. Pure.
 *
 * Kairo compares the same product across marketplaces (Shopee, TikTok Shop, …). The cheapest listed
 * price (`VariantPricing.cheapest`) stays the basis of the Deal Score — price history has no
 * vouchers — but the buy button, the voucher block and "Mua ở sàn nào?" follow the price the buyer
 * actually pays, so a marketplace with a higher listed price and a good voucher can win.
 */
import type { PricedOffer } from "@/lib/pricing/variant-pricing";

/** What the buyer pays for this offer: the effective price when it is lower, else the listed price. */
export function buyPrice(offer: Pick<PricedOffer, "price" | "effectivePrice">): number | null {
  const price = offer.price;
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const effective = offer.effectivePrice;
  return effective != null && Number.isFinite(effective) && effective >= 0 && effective < price ? effective : price;
}

/**
 * The in-stock offer with the lowest buyPrice(). Ties go to the lower listed price, then to the
 * earlier offer in the list (offers arrive sorted by listed price). null when nothing is in stock.
 */
export function pickBestBuy<T extends PricedOffer>(offers: readonly T[]): T | null {
  let best: T | null = null;
  let bestPay = Number.POSITIVE_INFINITY;
  for (const o of offers) {
    if (!o.inStock) continue;
    const pay = buyPrice(o);
    if (pay == null) continue;
    if (pay < bestPay || (pay === bestPay && best != null && (o.price as number) < (best.price as number))) {
      best = o;
      bestPay = pay;
    }
  }
  return best;
}
