import { detectFakeSale, type DealScoreResult } from "@/lib/pricing/deal-score";
import { scoreDeal } from "@/lib/pricing/score";
import { discountPercent } from "@/lib/format";
import { pickBestBuy } from "@/lib/pricing/best-buy";
import {
  expandRollup,
  historyStats,
  medianWindow,
  type DailyPriceRow,
  type HistoryStats,
} from "@/lib/pricing/price-history";

export const FLASH_SALE_REASON =
  "⚠ Giá hiện tại là giá flash sale, chỉ kéo dài trong thời gian ngắn";

export interface OfferRow {
  offerId: string;
  marketplace: string;
  listingUrl: string | null;
  listingStatus: string;
  matchStatus: "auto" | "manual" | "rejected" | "pending";
  sellerName: string | null;
  sellerRating: number | null;
  sellerRatingCount: number | null;
  sellerIsOfficial: boolean;
  affiliateEligible: boolean;
  price: number | null;
  originalPrice: number | null;
  stock: number | null;
  isFlashSale: boolean;
  /** null = no observation yet. Do NOT substitute "now": the data would look fresher than it is. */
  observedAt: string | null;
  /** Price after the best voucher combination (fresh and lower than `price`), else null/absent. */
  effectivePrice?: number | null;
}

export interface PricedOffer extends OfferRow {
  inStock: boolean;
  discountPercent: number | null;
  /**
   * detectFakeSale() for THIS offer's price and list price against the variant's history. null = no
   * sign found, or the check could not run (see discountChecked).
   */
  fakeSaleMessage: string | null;
  /** The history check ran (≥ 14 days in the last 30). Only then can a list-price discount be called real. */
  discountChecked: boolean;
}

/**
 * The seller's list-price discount passed Kairo's history check — the only case the solid "−X%" chip
 * (DESIGN.md "chip mức giảm thật") may be shown. Unchecked or doubtful discounts are shown neutrally.
 */
export function isDiscountVerified(offer: Pick<PricedOffer, "discountPercent" | "discountChecked" | "fakeSaleMessage">): boolean {
  return offer.discountPercent != null && offer.discountChecked && !offer.fakeSaleMessage?.trim();
}

export interface VariantPricing {
  offers: PricedOffer[]; // in stock by ascending price, then out of stock
  cheapest: PricedOffer | null; // cheapest in-stock offer by listed price — the Deal Score basis
  /**
   * In-stock offer that costs least after vouchers (pickBestBuy) — may be another marketplace than
   * `cheapest`. Drives the buy button, the voucher block and "Mua ở sàn nào?".
   */
  bestBuy: PricedOffer | null;
  /**
   * When NO offer is in stock: the offer with the most recently recorded price, to show
   * "Tạm hết hàng" + the last price (1.2.a.4). null when in stock, or no price yet.
   */
  lastKnown: PricedOffer | null;
  /** true when offers have prices but all are out of stock — no scoring (1.2.e). */
  allOutOfStock: boolean;
  /** Header score. Called WITHOUT bestOffer (decision Đ7). */
  headline: DealScoreResult | null;
  /**
   * 90-day low / median / high for StatsRow. Always computed, even when the Deal
   * Score is below threshold (1.2.d.3: "still show the numbers we have").
   */
  stats: HistoryStats;
  /**
   * Fake-sale message for the offer the page shows as its price (bestBuy, else cheapest): the hero's
   * discount chip, the verdict note and the discount banner all describe that same offer.
   */
  fakeSaleMessage: string | null;
  trackingSince: string | null; // 'YYYY-MM-DD'
  updatedAt: string | null;
  isStale: boolean; // updatedAt older than 48 hours
}

/** Same rule as SQL `offer_is_visible()` (migration 0022) — keep the two in sync. */
export function isOfferVisible(offer: OfferRow, isDraftProduct: boolean): boolean {
  if (offer.listingStatus !== "active") return false;
  if (offer.matchStatus === "auto" || offer.matchStatus === "manual") return true;
  // A draft product created by ingest has a 'pending' offer pointing at that same draft variant (Đ6).
  if (offer.matchStatus === "pending" && isDraftProduct) return true;
  return false;
}

export function buildVariantPricing(input: {
  offers: OfferRow[];
  history: DailyPriceRow[];
  trackingSince: string | null;
  isDraftProduct: boolean;
  now?: Date;
}): VariantPricing {
  const { offers, history, trackingSince, isDraftProduct, now = new Date() } = input;
  const historyObs = expandRollup(history);

  // 1. Keep only displayable offers
  const visibleOffers = offers.filter((o) => isOfferVisible(o, isDraftProduct));

  // 2. Classify stock and compute basics
  const mappedOffers: PricedOffer[] = visibleOffers.map((o) => {
    const inStock = o.stock == null || o.stock > 0;
    const disc = discountPercent(o.price, o.originalPrice);
    return {
      ...o,
      inStock,
      discountPercent: disc,
      fakeSaleMessage: null,
      discountChecked: false,
    };
  });

  // 3. Sort: in stock first (ascending price), then out of stock (ascending price). Null prices last.
  mappedOffers.sort((a, b) => {
    if (a.inStock && !b.inStock) return -1;
    if (!a.inStock && b.inStock) return 1;

    if (a.price != null && b.price != null) return a.price - b.price;
    if (a.price != null && b.price == null) return -1;
    if (a.price == null && b.price != null) return 1;
    return 0;
  });

  // 4. Cheapest in-stock offer
  const cheapest = mappedOffers.find((o) => o.inStock && o.price != null && o.price > 0) ?? null;

  // Out of stock at every seller: last price comes from the NEWEST observation.
  const pricedOffers = mappedOffers.filter((o) => o.price != null && o.price > 0);
  const lastKnown =
    cheapest == null
      ? ([...pricedOffers].sort(
          (a, b) =>
            (b.observedAt ? Date.parse(b.observedAt) : 0) -
            (a.observedAt ? Date.parse(a.observedAt) : 0),
        )[0] ?? null)
      : null;

  // 5. Header Deal Score (Đ7: do NOT pass bestOffer)
  let headline: DealScoreResult | null = null;
  if (cheapest && cheapest.price != null) {
    // History-only (no stock / seller): must equal the cached listing score (Đ7).
    headline = scoreDeal({
      price: cheapest.price,
      history: historyObs,
      now,
    });
    // History excludes flash sales, so a current flash price is almost always "Buy".
    // Keep the score, but make clear this price is temporary.
    if (cheapest.isFlashSale && headline.score != null) {
      headline = {
        ...headline,
        reasons: [FLASH_SALE_REASON, ...headline.reasons].slice(0, 4),
      };
    }
  }

  // 6. Fake Sale Detection, per offer: the page shows one offer's price and list price (bestBuy),
  // so its discount chip must be judged on that offer — not on another seller's list price.
  const m30 = medianWindow(history, 30, 0, now);
  const m14 = medianWindow(history, 14, 0, now);
  const m60 = medianWindow(history, 74, 14, now);
  for (const offer of mappedOffers) {
    if (offer.price == null || offer.price <= 0) continue;
    // Heuristic #1 only runs when m30.dayCount >= 14
    if (m30.dayCount < 14) continue;
    // Heuristic #2 ("price hike before the sale") only makes sense when a sale IS
    // running: a struck-through list price, or a current price below the 14-day
    // median. Otherwise a product that merely raised its price gets labelled — a
    // claim about the seller that "better to miss" (design §13) does not allow.
    const onSale = offer.discountPercent != null || (m14.value != null && offer.price < m14.value);
    const priceHikeCheckable = onSale && m14.dayCount >= 10 && m60.dayCount >= 30;
    offer.discountChecked = true;
    offer.fakeSaleMessage = detectFakeSale({
      currentPrice: offer.price,
      listedPrice: offer.originalPrice ?? 0,
      median30d: m30.value ?? 0,
      median14dBeforeSale: priceHikeCheckable ? m14.value ?? undefined : undefined,
      median60dBefore: priceHikeCheckable ? m60.value ?? undefined : undefined,
    });
  }

  // 7. Update time & stale-data warning (> 48h)
  // Only counts displayable offers: a hidden offer (inactive listing,
  // uncertain matching) must not make the data look fresher than it is.
  let latestObservedAt: string | null = null;
  for (const o of mappedOffers) {
    if (o.observedAt) {
      if (!latestObservedAt || new Date(o.observedAt).getTime() > new Date(latestObservedAt).getTime()) {
        latestObservedAt = o.observedAt;
      }
    }
  }

  const ms48Hours = 48 * 3600 * 1000;
  const isStale = latestObservedAt
    ? now.getTime() - new Date(latestObservedAt).getTime() > ms48Hours
    : false;

  const bestBuy = pickBestBuy(mappedOffers);
  return {
    offers: mappedOffers,
    cheapest,
    bestBuy,
    lastKnown,
    allOutOfStock: cheapest == null && lastKnown != null,
    headline,
    stats: historyStats(history, now),
    fakeSaleMessage: (bestBuy ?? cheapest)?.fakeSaleMessage ?? null,
    trackingSince,
    updatedAt: latestObservedAt,
    isStale,
  };
}
