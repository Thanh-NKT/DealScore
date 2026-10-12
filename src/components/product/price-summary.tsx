import { isDiscountVerified, type PricedOffer } from "@/lib/pricing/variant-pricing";
import { formatVnd } from "@/lib/format";
import { ClockIcon, TrendDownIcon } from "@/components/ui/icons";
import { marketplaceName } from "./marketplace";
import { MarketplaceChip } from "./marketplace-mark";

interface PriceSummaryProps {
  /**
   * The offer whose price the page shows (best buy, else cheapest), or — when out of stock everywhere —
   * the offer with the most recent recorded price. Its own discount check (fakeSaleMessage /
   * discountChecked) decides how the seller's "−X%" is shown.
   */
  cheapest: PricedOffer | null;
  offerCount: number;
}

/** 0 or negative prices are marketplace data errors: never render them as "0đ". */
function validPrice(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

const LABEL = "eyebrow text-ink-3";

export function PriceSummary({ cheapest, offerCount }: PriceSummaryProps) {
  const price = validPrice(cheapest?.price);

  if (!cheapest || price == null) {
    return (
      <div className="min-w-0 space-y-2">
        <p className={LABEL}>Giá hiện tại</p>
        <p className="num text-price-hero font-bold leading-none text-ink-3 max-[760px]:text-price-sm" aria-hidden="true">
          —
        </p>
        <p className="text-body-sm text-ink-2">Chưa có dữ liệu giá cho phiên bản này.</p>
      </div>
    );
  }

  const where = marketplaceName(cheapest.marketplace);

  if (!cheapest.inStock) {
    return (
      <div className="min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className={LABEL}>Giá hiện tại</span>
          <MarketplaceChip marketplace={cheapest.marketplace} />
        </div>
        <p className="num text-price-hero font-bold leading-none text-ink-3 max-[760px]:text-price-sm" aria-hidden="true">
          —
        </p>
        <p className="text-control font-semibold text-ink">Tạm hết hàng ở mọi người bán.</p>
        <p className="text-body-sm text-ink-2">
          Giá ghi nhận gần nhất <span className="num font-bold text-ink">{formatVnd(price)}</span>
        </p>
      </div>
    );
  }

  const listed = validPrice(cheapest.originalPrice);
  const off = cheapest.discountPercent;
  const showListed = listed != null && off != null && off > 0 && listed > price;
  const saved = showListed && listed != null ? listed - price : null;
  // Three honest states for the seller's list-price discount: verified against history (solid buy chip,
  // "Tiết kiệm"), flagged by the fake-sale check ("Giảm giá chưa thực chất"), or not checkable yet
  // (neutral chip: it is only the seller's claim).
  const discountDoubtful = Boolean(cheapest.fakeSaleMessage?.trim());
  const discountVerified = isDiscountVerified(cheapest);
  const effectiveRaw = validPrice(cheapest.effectivePrice);
  const effective = effectiveRaw != null && effectiveRaw < price ? effectiveRaw : null;
  const text = formatVnd(price);
  const fitDivisor = text.length * 0.62 + 0.2;

  return (
    <div className="@container min-w-0 flex-1 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={LABEL}>{offerCount > 1 ? "Giá tốt nhất hiện tại" : "Giá hiện tại"}</span>
        <MarketplaceChip marketplace={cheapest.marketplace} />
        {cheapest.sellerIsOfficial && (
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-micro font-semibold text-primary">
            Gian hàng chính hãng
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-3">
        <p
          className="num font-bold leading-none tracking-tight text-ink [--cap:38px] min-[761px]:[--cap:50px]"
          style={{ fontSize: `min(var(--cap), calc(100cqi / ${fitDivisor.toFixed(2)}))` }}
        >
          <span className="sr-only">Giá hiện tại: </span>
          {text}
        </p>

        {showListed && discountVerified && off != null && (
          <span className="num inline-flex items-center gap-1 rounded-full bg-buy px-2.5 py-1 text-label font-bold text-canvas shadow-2xs">
            <TrendDownIcon className="size-3.5" strokeWidth={2.6} />
            −{off}%
          </span>
        )}
        {showListed && !discountVerified && !discountDoubtful && off != null && (
          <span className="num inline-flex items-center rounded-full border border-line-strong/60 bg-surface px-2.5 py-1 text-label font-bold text-ink-2">
            −{off}%
          </span>
        )}
      </div>

      {/* DESIGN.md "Giá ước tính trong khung": the after-voucher estimate never sits in the decision box
          next to the real price. Point to the voucher block, which shows it framed ("~", "Ước tính"). */}
      {effective != null && (
        <p className="text-body-sm text-ink-2">
          <a href="#ma-giam-gia" className="font-semibold text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary">
            Có mã giảm giá trên {where} · xem giá ước tính
          </a>
        </p>
      )}

      {(showListed || cheapest.isFlashSale) && (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pt-0.5 text-label text-ink-3">
          {showListed && listed != null && (
            <span className="flex flex-wrap items-center gap-2">
              <span>
                Giá niêm yết <s className="num decoration-[1.5px]">{formatVnd(listed)}</s>
              </span>
              {discountDoubtful ? (
                <span className="rounded-full bg-wait-soft px-2.5 py-0.5 text-micro font-semibold text-wait">
                  Giảm giá chưa thực chất
                </span>
              ) : discountVerified && saved != null && saved > 0 ? (
                <span className="font-bold text-buy">
                  · Tiết kiệm <span className="num">{formatVnd(saved)}</span>
                </span>
              ) : !discountVerified ? (
                <span>· Mức giảm do người bán ghi, chưa đủ lịch sử để kiểm tra</span>
              ) : null}
            </span>
          )}
          {cheapest.isFlashSale && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-wait-soft px-2.5 py-0.5 text-micro font-semibold text-wait">
              <ClockIcon className="size-3.5" />
              Flash sale ngắn hạn
            </span>
          )}
        </div>
      )}
    </div>
  );
}
