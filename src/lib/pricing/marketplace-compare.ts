/**
 * "Mua ở sàn nào?" (Phase 2): cheapest in-stock offer per marketplace. Pure.
 * Returns null unless at least two marketplaces have a real in-stock price — never simulated
 * (PRODUCT.md: cross-marketplace comparison only with ≥ 2 real marketplaces).
 */
import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { marketplaceName } from "@/lib/marketplaces";
import { formatVnd } from "@/lib/format";

export interface MarketplaceRow {
  marketplace: string;
  name: string;
  /** Cheapest in-stock price on this marketplace. */
  price: number;
  offerId: string;
  /** In-stock sellers on this marketplace. */
  sellers: number;
  /** Difference with the cheapest marketplace (0 for the cheapest). */
  gap: number;
}

export interface MarketplaceComparison {
  rows: MarketplaceRow[];
  cheapest: string;
  summary: string;
}

const TIE_RATIO = 0.01;

export function compareMarketplaces(offers: PricedOffer[]): MarketplaceComparison | null {
  const best = new Map<string, { price: number; offerId: string; sellers: number }>();
  for (const o of offers) {
    if (!o.inStock || o.price == null || !(o.price > 0)) continue;
    const cur = best.get(o.marketplace);
    if (!cur) best.set(o.marketplace, { price: o.price, offerId: o.offerId, sellers: 1 });
    else {
      cur.sellers++;
      if (o.price < cur.price) Object.assign(cur, { price: o.price, offerId: o.offerId });
    }
  }
  if (best.size < 2) return null;

  const sorted = [...best.entries()].sort((a, b) => a[1].price - b[1].price);
  const low = sorted[0][1].price;
  const rows = sorted.map(([marketplace, v]) => ({
    marketplace,
    name: marketplaceName(marketplace),
    price: v.price,
    offerId: v.offerId,
    sellers: v.sellers,
    gap: v.price - low,
  }));

  const [first, second] = rows;
  const summary =
    second.gap / second.price < TIE_RATIO
      ? "Giá trên các sàn gần như bằng nhau."
      : `Rẻ nhất trên ${first.name}, thấp hơn ${second.name} ${formatVnd(second.gap)} (${Math.round((second.gap / second.price) * 100)}%).`;

  return { rows, cheapest: first.marketplace, summary };
}
