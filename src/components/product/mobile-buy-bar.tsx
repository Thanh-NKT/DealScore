import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { formatVnd } from "@/lib/format";
import { BuyButton } from "./buy-button";
import { verdictText } from "./verdict-tag";

interface MobileBuyBarProps {
  offer: PricedOffer | null;
  recommendation: Recommendation | null;
  productName: string;
  /** Headline Deal Score; null when the engine could not score (the bar then says so in words). */
  score?: number | null;
}

/**
 * Phones only (≤760px) sticky buy bar (DESIGN.md "Thanh mua dính đáy"): a floating white layer with
 * the one `shadow-lift`. Name, price and "N điểm · <kết luận>" stay within thumb reach while the
 * shopper scrolls the evidence; the primary button keeps its "Liên kết tiếp thị" label (the full
 * sentence is in the price card). Plain CSS, no JS. Renders nothing when there is no in-stock offer
 * to send the shopper to.
 */
export function MobileBuyBar({ offer, recommendation, productName, score = null }: MobileBuyBarProps) {
  const price = offer?.price;
  if (!offer || !offer.inStock || price == null || !Number.isFinite(price) || price <= 0) return null;

  const value = score != null && Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : null;
  const verdict = recommendation ? verdictText(recommendation) : null;
  const scoreLine = value != null && verdict ? `${value} điểm · ${verdict}` : verdict;

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lift min-[761px]:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-ink">{productName}</p>
          <p className="num truncate text-[18px] font-extrabold leading-tight text-ink">{formatVnd(price)}</p>
          {scoreLine && <p className="truncate text-[12px] font-semibold text-ink-2">{scoreLine}</p>}
        </div>
        <BuyButton
          offerId={offer.offerId}
          marketplace={offer.marketplace}
          hasLink={Boolean(offer.listingUrl)}
          affiliate={offer.affiliateEligible}
          variant="primary"
          className="w-40 shrink-0"
        />
      </div>
    </div>
  );
}
