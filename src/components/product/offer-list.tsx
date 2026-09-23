import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { formatVnd } from "@/lib/format";
import { BuyButton } from "./buy-button";

interface OfferListProps {
  offers: PricedOffer[];
}

export function OfferList({ offers }: OfferListProps) {
  if (!offers || offers.length === 0) {
    return (
      <div className="rounded-xl border border-border p-6 text-center text-sm text-muted">
        Chưa có người bán nào được theo dõi cho phiên bản này.
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Người bán ({offers.length})
        </h3>
        {offers.length === 1 && (
          <span className="text-xs text-muted">
            Hiện chỉ có 1 người bán được theo dõi
          </span>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border divide-y divide-border">
        {offers.map((offer, index) => {
          const isCheapest = index === 0 && offer.inStock && offer.price != null;

          return (
            <div
              key={offer.offerId}
              className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between ${
                !offer.inStock ? "opacity-50 bg-black/[0.01] dark:bg-white/[0.01]" : ""
              }`}
            >
              {/* Thông tin Seller */}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground text-sm">
                    {offer.sellerName || "Người bán Shopee"}
                  </span>

                  {offer.sellerIsOfficial && (
                    <span className="rounded bg-red-600/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                      Mall chính hãng
                    </span>
                  )}

                  {isCheapest && (
                    <span className="rounded bg-rec-buy-bg px-1.5 py-0.5 text-[10px] font-bold text-rec-buy">
                      Rẻ nhất
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3 text-xs text-muted">
                  {offer.sellerRating != null && (
                    <span>⭐ {offer.sellerRating.toFixed(1)}</span>
                  )}
                  {offer.sellerRatingCount != null && (
                    <span>({offer.sellerRatingCount.toLocaleString("vi-VN")} đánh giá)</span>
                  )}
                  {offer.isFlashSale && offer.inStock && (
                    <span className="font-medium text-rec-wait">Flash sale</span>
                  )}
                  {!offer.inStock && (
                    <span className="font-medium text-rec-avoid">Tạm hết hàng</span>
                  )}
                </div>
              </div>

              {/* Điểm riêng + Giá + Nút mua */}
              <div className="flex items-center justify-between sm:justify-end gap-4">
                {offer.dealScore && offer.dealScore.score != null && (
                  <div className="text-right">
                    <div className="text-xs font-semibold text-muted">
                      Điểm offer
                    </div>
                    <div className="text-sm font-bold text-foreground">
                      {offer.dealScore.score}/100
                    </div>
                  </div>
                )}

                <div className="text-right">
                  <div className="text-lg font-bold text-foreground">
                    {formatVnd(offer.price)}
                  </div>
                  {offer.discountPercent !== null && offer.originalPrice != null && (
                    <div className="text-xs text-muted">
                      <s>{formatVnd(offer.originalPrice)}</s>
                    </div>
                  )}
                </div>

                <BuyButton
                  offerId={offer.offerId}
                  marketplace={offer.marketplace}
                  disabled={!offer.inStock}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Dòng disclosure affiliate bắt buộc */}
      <p className="text-[11px] text-muted leading-relaxed">
        Chúng tôi có thể nhận hoa hồng khi bạn mua qua liên kết này. Giá bạn trả không thay đổi.
      </p>
    </section>
  );
}
