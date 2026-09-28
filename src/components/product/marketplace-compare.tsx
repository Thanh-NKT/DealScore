import type { MarketplaceComparison } from "@/lib/pricing/marketplace-compare";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { formatVnd } from "@/lib/format";
import { BuyButton } from "./buy-button";
import { AFFILIATE_SENTENCE, MARKETPLACE_CHIP, NEUTRAL_CHIP, OFFER_CARD, OFFER_GRID } from "./offer-list";

/**
 * "So sánh giữa các sàn" (Phase 2, DESIGN.md "Bảng so giá nơi bán"). Only rendered when
 * compareMarketplaces() found at least two marketplaces with a real in-stock price. Neutral chips,
 * same template for every marketplace; the cheapest row says so with a neutral "Rẻ nhất" chip and
 * gets the one primary button, the others show the gap in ink-3 and a secondary button.
 */
export function MarketplaceCompare({ comparison, offers }: { comparison: MarketplaceComparison; offers: PricedOffer[] }) {
  const byId = new Map(offers.map((o) => [o.offerId, o]));
  return (
    <section aria-labelledby="marketplace-compare-heading" className={OFFER_CARD}>
      <div className="space-y-1">
        <h2 id="marketplace-compare-heading" className="display text-[22px] font-bold leading-tight text-ink">
          So sánh giữa các sàn
        </h2>
        <p className="max-w-[75ch] text-[14px] text-ink-2">{comparison.summary}</p>
      </div>

      <div>
        <div
          aria-hidden="true"
          className={`${OFFER_GRID} border-b border-line pb-2.5 text-[12px] font-bold text-ink-3 max-[760px]:hidden`}
        >
          <span>Sàn</span>
          <span>Người bán còn hàng</span>
          <span className="text-right">Giá tốt nhất trên sàn</span>
          <span />
        </div>
        <ul>
          {comparison.rows.map((row) => {
            const offer = byId.get(row.offerId);
            return (
              <li key={row.marketplace} className={`${OFFER_GRID} border-t border-line py-4 first:border-t-0`}>
                <div className="col-span-2 min-w-0 min-[761px]:col-span-1">
                  <span className={MARKETPLACE_CHIP}>{row.name}</span>
                </div>
                <p className="text-[13px] text-ink-2">
                  <span className="num font-bold text-ink">{row.sellers}</span> người bán còn hàng
                </p>
                <div className="flex flex-col items-end gap-1 text-right">
                  <p className="num text-[18px] font-extrabold leading-tight text-ink">{formatVnd(row.price)}</p>
                  {row.gap === 0 ? (
                    <span className={NEUTRAL_CHIP}>Rẻ nhất</span>
                  ) : (
                    <span className="num whitespace-nowrap text-[13px] text-ink-3">+{formatVnd(row.gap)}</span>
                  )}
                </div>
                <BuyButton
                  offerId={row.offerId}
                  marketplace={row.marketplace}
                  hasLink={Boolean(offer?.listingUrl)}
                  affiliate={offer?.affiliateEligible ?? false}
                  variant={row.marketplace === comparison.cheapest ? "primary" : "secondary"}
                  affiliateLabel={false}
                  className="col-span-2 min-[761px]:col-span-1"
                />
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-line pt-4">
        <p className="max-w-[75ch] text-[13px] leading-[1.45] text-ink-3">{AFFILIATE_SENTENCE}</p>
      </div>
    </section>
  );
}
