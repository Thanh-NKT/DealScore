import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { formatVnd } from "@/lib/format";
import { ClockIcon, TrendDownIcon } from "@/components/ui/icons";
import { marketplaceName, marketplaceStyle } from "./marketplace";

interface PriceSummaryProps {
  /** Cheapest in-stock offer, or — when out of stock everywhere — the offer with the most recent recorded price. */
  cheapest: PricedOffer | null;
  offerCount: number;
  /**
   * The discount check failed (detectFakeSale): the seller's "−X%" is replaced by the words
   * "Giảm giá chưa thực chất".
   */
  discountDoubtful?: boolean;
}

/** 0 or negative prices are marketplace data errors: never render them as "0đ". */
function validPrice(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

const LABEL = "text-[13px] font-semibold text-ink-3";

export function PriceSummary({ cheapest, offerCount, discountDoubtful = false }: PriceSummaryProps) {
  const price = validPrice(cheapest?.price);

  if (!cheapest || price == null) {
    return (
      <div className="min-w-0 space-y-2">
        <p className={LABEL}>Giá hiện tại</p>
        <p className="num text-[44px] font-extrabold leading-none text-ink-3 max-[760px]:text-[34px]" aria-hidden="true">
          —
        </p>
        <p className="text-[14px] text-ink-2">Chưa có dữ liệu giá cho phiên bản này.</p>
      </div>
    );
  }

  const where = marketplaceName(cheapest.marketplace);
  const mBadge = marketplaceStyle(cheapest.marketplace).badge;

  if (!cheapest.inStock) {
    return (
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className={LABEL}>Giá hiện tại</span>
          <span className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold ${mBadge}`}>
            {where}
          </span>
        </div>
        <p className="num text-[44px] font-extrabold leading-none text-ink-3 max-[760px]:text-[34px]" aria-hidden="true">
          —
        </p>
        <p className="text-[15px] font-semibold text-ink">Tạm hết hàng ở mọi người bán.</p>
        <p className="text-[14px] text-ink-2">
          Giá ghi nhận gần nhất <span className="num font-bold text-ink">{formatVnd(price)}</span>
        </p>
      </div>
    );
  }

  const listed = validPrice(cheapest.originalPrice);
  const off = cheapest.discountPercent;
  const showListed = listed != null && off != null && off > 0 && listed > price;
  const saved = showListed && listed != null ? listed - price : null;
  const text = formatVnd(price);
  const fitDivisor = text.length * 0.58 + 0.2;

  return (
    <div className="@container min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>{offerCount > 1 ? "Giá tốt nhất hiện tại" : "Giá hiện tại"}</span>
        <span className={`rounded-md px-2.5 py-0.5 text-[11px] font-bold ${mBadge}`}>
          {where}
        </span>
        {cheapest.sellerIsOfficial && (
          <span className="rounded-md bg-primary-soft px-2.5 py-0.5 text-[11px] font-bold text-primary">
            Gian hàng chính hãng
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-3">
        <p
          className="num font-extrabold leading-none text-ink [--cap:36px] min-[761px]:[--cap:46px]"
          style={{ fontSize: `min(var(--cap), calc(100cqi / ${fitDivisor.toFixed(2)}))` }}
        >
          <span className="sr-only">Giá hiện tại: </span>
          {text}
        </p>

        {showListed && !discountDoubtful && off != null && (
          <span className="num inline-flex items-center gap-1 rounded-full bg-buy px-2.5 py-1 text-[13px] font-extrabold text-canvas shadow-2xs">
            <TrendDownIcon className="size-3.5" strokeWidth={2.6} />
            −{off}%
          </span>
        )}
      </div>

      {(showListed || cheapest.isFlashSale) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5 text-[13px] text-ink-3">
          {showListed && listed != null && (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                Giá niêm yết <s className="num decoration-[1.5px]">{formatVnd(listed)}</s>
              </span>
              {discountDoubtful ? (
                <span className="rounded-xs bg-wait-soft px-2 py-0.5 text-[12px] font-semibold text-wait">
                  Giảm giá chưa thực chất
                </span>
              ) : saved != null && saved > 0 ? (
                <span className="font-bold text-buy">
                  · Tiết kiệm <span className="num">{formatVnd(saved)}</span>
                </span>
              ) : null}
            </span>
          )}
          {cheapest.isFlashSale && (
            <span className="inline-flex items-center gap-1.5 rounded-sm border border-wait/30 bg-wait-soft px-2 py-0.5 text-[12px] font-semibold text-wait">
              <ClockIcon className="size-3.5" />
              Flash sale ngắn hạn
            </span>
          )}
        </div>
      )}
    </div>
  );
}
