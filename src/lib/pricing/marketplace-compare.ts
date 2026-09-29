/**
 * "Mua ở sàn nào?" (Phase 2): the best in-stock offer per marketplace, ranked by the price the buyer
 * pays after vouchers (buyPrice). Pure.
 * Returns null unless at least two marketplaces have a real in-stock price — never simulated
 * (PRODUCT.md: cross-marketplace comparison only with ≥ 2 real marketplaces).
 */
import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { buyPrice } from "@/lib/pricing/best-buy";
import { marketplaceName } from "@/lib/marketplaces";
import { formatVnd } from "@/lib/format";

export interface MarketplaceRow {
  marketplace: string;
  name: string;
  /** Listed price of this marketplace's best offer. */
  price: number;
  /** That offer's price after vouchers, when lower than `price`; else null. */
  effectivePrice: number | null;
  offerId: string;
  /** In-stock sellers on this marketplace. */
  sellers: number;
  /** Difference with the best marketplace, on the price paid (0 for the best). */
  gap: number;
}

export interface MarketplaceComparison {
  rows: MarketplaceRow[];
  cheapest: string;
  summary: string;
}

const TIE_RATIO = 0.01;

export function compareMarketplaces(offers: PricedOffer[]): MarketplaceComparison | null {
  const best = new Map<string, { pay: number; offer: PricedOffer; sellers: number }>();
  for (const o of offers) {
    if (!o.inStock) continue;
    const pay = buyPrice(o);
    if (pay == null) continue;
    const cur = best.get(o.marketplace);
    if (!cur) best.set(o.marketplace, { pay, offer: o, sellers: 1 });
    else {
      cur.sellers++;
      if (pay < cur.pay) Object.assign(cur, { pay, offer: o });
    }
  }
  if (best.size < 2) return null;

  const sorted = [...best.entries()].sort((a, b) => a[1].pay - b[1].pay);
  const low = sorted[0][1].pay;
  const rows = sorted.map(([marketplace, v]) => ({
    marketplace,
    name: marketplaceName(marketplace),
    price: v.offer.price as number,
    effectivePrice: v.pay < (v.offer.price as number) ? v.pay : null,
    offerId: v.offer.offerId,
    sellers: v.sellers,
    gap: v.pay - low,
  }));

  const [first, second] = rows;
  const secondPay = second.effectivePrice ?? second.price;
  const afterVoucher = first.effectivePrice != null ? " sau voucher" : "";
  const summary =
    second.gap / secondPay < TIE_RATIO
      ? "Giá trên các sàn gần như bằng nhau."
      : `Rẻ nhất trên ${first.name}${afterVoucher}, thấp hơn ${second.name} ${formatVnd(second.gap)} (${Math.round((second.gap / secondPay) * 100)}%).`;

  return { rows, cheapest: first.marketplace, summary };
}
