import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { formatVnd } from "@/lib/format";
import { CheckCircleIcon, ClockIcon } from "@/components/ui/icons";
import { BuyButton } from "./buy-button";
import { marketplaceName, marketplaceStyle } from "./marketplace";

interface OfferListProps {
  offers: PricedOffer[];
}

const VISIBLE_ROWS = 8;

export const OFFER_CARD = "flex flex-col gap-5 rounded-lg border border-line bg-surface p-6 sm:p-7";
export const OFFER_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 min-[761px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(7rem,auto)_9rem]";
export const MARKETPLACE_CHIP =
  "inline-block max-w-full truncate rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-micro font-semibold text-ink-2";
export const NEUTRAL_CHIP = "rounded-lg bg-buy-soft px-2 py-0.5 text-micro font-bold text-buy";
export const AFFILIATE_SENTENCE =
  "Các nút “Đến …” là liên kết tiếp thị. Nếu bạn mua qua liên kết, Kairo có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả.";

function validPrice(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function formatCount(n: number): string {
  if (n < 1000) return n.toLocaleString("vi-VN");
  const k = n / 1000;
  return `${(k < 100 ? k.toFixed(1) : Math.round(k).toString()).replace(".", ",").replace(",0", "")}k`;
}

function OfferRow({
  offer,
  cheapestPrice,
  showBest,
  primary,
}: {
  offer: PricedOffer;
  cheapestPrice: number | null;
  showBest: boolean;
  primary: boolean;
}) {
  const price = validPrice(offer.price);
  // Price after the best voucher combination, shipping not included (page-data keeps it fresh + lower).
  const effective = validPrice(offer.effectivePrice);
  const isBest = showBest && offer.inStock && price != null && price === cheapestPrice;
  const seller = offer.sellerName?.trim() || "Người bán chưa rõ tên";
  const rating = offer.sellerRating;
  const ratingCount = offer.sellerRatingCount;
  const hasRating = rating != null && Number.isFinite(rating) && rating > 0;
  const diffFromBest =
    !isBest && price != null && cheapestPrice != null && price > cheapestPrice
      ? price - cheapestPrice
      : null;
  const mBadge = marketplaceStyle(offer.marketplace).badge;

  return (
    <div
      className={`grid grid-cols-1 items-center gap-3 rounded-tile border p-4 transition-colors min-[761px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_136px] min-[761px]:gap-4 ${
        primary
          ? "border-buy/40 bg-buy-soft/20"
          : "border-line bg-surface hover:border-line-strong"
      }`}
    >
      {/* Col 1: Seller / Shop */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-md px-2 py-0.5 text-nano font-bold ${mBadge}`}>
            {marketplaceName(offer.marketplace)}
          </span>
          {offer.sellerIsOfficial && (
            <span className="rounded-sm bg-primary-soft px-2 py-0.5 text-nano font-bold text-primary">
              Chính hãng
            </span>
          )}
          {isBest && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-buy px-2 py-0.5 text-nano font-bold text-canvas">
              <CheckCircleIcon className="size-3" strokeWidth={2.5} />
              Giá tốt nhất
            </span>
          )}
        </div>
        <span className="truncate text-body-sm font-semibold text-ink" title={seller}>
          {seller}
        </span>
      </div>

      {/* Col 2: Rating & Stock */}
      <div className="flex flex-col gap-0.5 text-label text-ink-2">
        <div>
          {hasRating ? (
            <span className="inline-flex items-center gap-1">
              <b className="num font-bold text-ink">{rating.toFixed(1).replace(".", ",")} ★</b>
              {ratingCount && <span className="text-ink-3">({formatCount(ratingCount)})</span>}
            </span>
          ) : (
            <span className="text-ink-3">Chưa có đánh giá</span>
          )}
        </div>
        <span className={`inline-flex items-center gap-1.5 text-micro font-medium ${offer.inStock ? "text-buy" : "text-ink-3"}`}>
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${offer.inStock ? "bg-buy" : "border border-ink-3"}`}
          />
          {offer.inStock ? "Còn hàng" : "Tạm hết hàng"}
        </span>
      </div>

      {/* Col 3: Perks / Flash sale */}
      <div className="text-label text-ink-2">
        {offer.isFlashSale ? (
          <span className="inline-flex items-center gap-1 rounded-sm bg-wait-soft px-2 py-0.5 text-micro font-semibold text-wait">
            <ClockIcon className="size-3.5" /> Flash sale
          </span>
        ) : offer.sellerIsOfficial ? (
          <span className="font-medium text-ink-2">Gian hàng chính hãng</span>
        ) : (
          <span className="text-ink-3" aria-label="Không có ưu đãi">
            —
          </span>
        )}
      </div>

      {/* Col 4: Price & Diff */}
      <div className="flex flex-col items-start gap-0.5 min-[761px]:items-end">
        {price != null ? (
          <span className="num display text-price-row font-extrabold tracking-tight text-ink">
            {formatVnd(price)}
          </span>
        ) : (
          <span className="text-body-sm font-medium text-ink-3">Chưa có giá</span>
        )}
        {price != null && effective != null && effective < price && (
          <span className="text-micro font-semibold text-ink-2">
            ≈ <span className="num">{formatVnd(effective)}</span> sau voucher
          </span>
        )}
        {diffFromBest != null && (
          <span className="num text-nano font-medium text-ink-3">
            +{formatVnd(diffFromBest)}
          </span>
        )}
      </div>

      {/* Col 5: CTA Button */}
      <div>
        <BuyButton
          offerId={offer.offerId}
          marketplace={offer.marketplace}
          disabled={!offer.inStock || price == null}
          hasLink={Boolean(offer.listingUrl)}
          affiliate={offer.affiliateEligible}
          variant={primary ? "primary" : "secondary"}
          affiliateLabel={false}
          className="w-full"
        />
      </div>
    </div>
  );
}

export function OfferList({ offers }: OfferListProps) {
  const list = offers ?? [];

  if (list.length === 0) {
    return (
      <section aria-labelledby="offers-heading" className={OFFER_CARD}>
        <h2 id="offers-heading" className="display text-h3 font-bold tracking-tight text-ink">
          So giá nơi bán
        </h2>
        <p className="rounded-md border border-dashed border-line-strong p-5 text-body-sm text-ink-3">
          Chưa có nơi bán nào được theo dõi cho phiên bản này.
        </p>
      </section>
    );
  }

  const priced = list.filter((o) => o.inStock && validPrice(o.price) != null);
  const cheapestPrice = priced.length > 0 ? Math.min(...priced.map((o) => o.price as number)) : null;
  const primaryId = priced.find((o) => o.price === cheapestPrice)?.offerId ?? null;
  const showBest = priced.length > 1;
  const head = list.slice(0, VISIBLE_ROWS);
  const rest = list.slice(VISIBLE_ROWS);

  return (
    <section aria-labelledby="offers-heading" className={OFFER_CARD}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
        <div className="flex flex-col gap-0.5">
          <h2 id="offers-heading" className="display text-h3 font-bold tracking-tight text-ink">
            So giá {list.length} nơi bán
          </h2>
          <span className="text-label text-ink-3">
            Đã gom các gian hàng bán cùng mẫu, cùng phân loại · xếp từ giá thấp nhất
          </span>
        </div>
        {cheapestPrice != null && (
          <span className="rounded-full bg-buy-soft px-3 py-1 text-micro font-bold text-buy">
            Từ <span className="num">{formatVnd(cheapestPrice)}</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_136px] gap-4 px-4 pb-1 text-micro font-bold text-ink-3 min-[761px]:grid"
        >
          <span>Nơi bán & gian hàng</span>
          <span>Đánh giá · Tình trạng</span>
          <span>Ưu đãi</span>
          <span className="text-right">Mức giá</span>
          <span />
        </div>

        <div className="flex flex-col gap-2.5">
          {head.map((offer) => (
            <OfferRow
              key={offer.offerId}
              offer={offer}
              cheapestPrice={cheapestPrice}
              showBest={showBest}
              primary={offer.offerId === primaryId}
            />
          ))}
        </div>

        {rest.length > 0 && (
          <details className="group pt-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-md border border-line bg-surface-2/50 text-label font-semibold text-primary hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Xem thêm {rest.length} nơi bán khác</span>
              <span className="hidden group-open:inline">Thu gọn danh sách</span>
            </summary>
            <div className="mt-2.5 flex flex-col gap-2.5">
              {rest.map((offer) => (
                <OfferRow
                  key={offer.offerId}
                  offer={offer}
                  cheapestPrice={cheapestPrice}
                  showBest={showBest}
                  primary={offer.offerId === primaryId}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      <span className="text-micro leading-[1.45] text-ink-3">
        {AFFILIATE_SENTENCE}
      </span>
    </section>
  );
}
