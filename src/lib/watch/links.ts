import { getAdapter } from "@/lib/marketplaces";
import type { WatchView } from "@/lib/watch/describe";

/** Pure, client-safe. The "Đến {sàn}" button on the watch list (roadmap P1 item 4). */

export interface WatchBuyTarget {
  offerId: string;
  marketplace: string;
  /** affiliate_offers.eligible of that offer — only drives the "Liên kết tiếp thị" disclosure. */
  affiliate: boolean;
}

/**
 * The "Đến {sàn}" target, or null unless all hold: a target price that is reached, in stock, a fresh price,
 * and a known best offer on a marketplace with an adapter (otherwise /go answers 404).
 */
export function watchBuyTarget(
  view: WatchView,
  offer: { marketplace: string; affiliate: boolean } | undefined,
  offerId: string | null,
): WatchBuyTarget | null {
  if (!view.target?.reached || !view.inStock || view.isStale || !offerId || !offer) return null;
  if (!getAdapter(offer.marketplace)) return null;
  return { offerId, marketplace: offer.marketplace, affiliate: offer.affiliate };
}

/** Always through /go (it checks the watch belongs to the signed-in user before tagging the click). */
export function watchGoHref(item: { id: string; buy: WatchBuyTarget | null }): string | null {
  if (!item.buy) return null;
  const { marketplace, offerId } = item.buy;
  return `/go/${encodeURIComponent(marketplace)}/${encodeURIComponent(offerId)}?src=web&watch=${encodeURIComponent(item.id)}`;
}
