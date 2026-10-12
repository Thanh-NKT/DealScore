import Link from "next/link";
import type { PricedOffer } from "@/lib/pricing/variant-pricing";
import { offerPerks, type OfferPerk } from "@/lib/pricing/offer-perks";
import type { Voucher } from "@/lib/vouchers/types";
import { formatVnd } from "@/lib/format";
import { CheckCircleIcon, ClockIcon, TicketIcon, TruckIcon } from "@/components/ui/icons";
import { BuyButton } from "./buy-button";
import { MarketplaceChip } from "./marketplace-mark";

interface OfferListProps {
  offers: PricedOffer[];
  /**
   * The offer the page's main buy button goes to (pricing.bestBuy: cheapest after vouchers). It gets
   * the "Giá tốt nhất" badge and the primary style, so the list and the hero never name two "best"
   * offers. Absent → the cheapest listed in-stock offer.
   */
  bestBuyId?: string | null;
  /** offerId → active vouchers of its listing (page-data offerVouchers), for the perk chips. */
  offerVouchers?: Record<string, Voucher[]>;
  /** id of the voucher section the "Có mã giảm giá" chip links to; null = plain text. */
  voucherAnchor?: string | null;
  /** offerId → seller id (page-data offerListings): the seller name links to /seller/{id} (P4 H). */
  offerSellers?: Record<string, string | null>;
}

/** Product page voucher section (VoucherPicker), the target of the "Có mã giảm giá" chip. */
export const VOUCHER_SECTION_ID = "ma-giam-gia";
const PERK_NEUTRAL = "inline-flex items-center gap-1 rounded-sm bg-surface-2 px-2 py-0.5 text-micro font-semibold text-ink-2 whitespace-nowrap";
const VOUCHER_TITLE = "Shop hoặc sàn đang có mã giảm giá — xem phần Mã giảm giá bên dưới";

function PerkChip({ perk, voucherAnchor }: { perk: OfferPerk; voucherAnchor: string | null }) {
  if (perk.kind === "flash") {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm bg-wait-soft px-2 py-0.5 text-micro font-semibold text-wait">
        <ClockIcon className="size-3.5" /> {perk.label}
      </span>
    );
  }
  if (perk.kind === "freeship") {
    return (
      <span className={PERK_NEUTRAL}>
        <TruckIcon className="size-3.5" /> {perk.label}
      </span>
    );
  }
  const body = (
    <>
      <TicketIcon className="size-3.5" /> {perk.label}
    </>
  );
  // The chip is ~20px tall; an invisible ::before extends the tap target to 40px (10px above and below)
  // without changing the chip. It is the last perk in its wrap, so the extra area covers nothing interactive.
  return voucherAnchor ? (
    <a
      href={`#${voucherAnchor}`}
      title={VOUCHER_TITLE}
      className={`${PERK_NEUTRAL} relative before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-[''] hover:bg-surface-2/70 hover:text-ink hover:underline`}
    >
      {body}
    </a>
  ) : (
    <span title={VOUCHER_TITLE} className={PERK_NEUTRAL}>
      {body}
    </span>
  );
}

const VISIBLE_ROWS = 8;

export const OFFER_CARD = "flex flex-col gap-6 rounded-lg border border-line bg-surface p-5 sm:p-7";
export const NEUTRAL_CHIP = "rounded-full bg-primary px-2.5 py-0.5 text-micro font-semibold text-on-primary";
export const AFFILIATE_SENTENCE =
  "Các nút “Đến …” là liên kết tiếp thị. Nếu bạn mua qua liên kết, DealScore có thể nhận hoa hồng. Điều này không làm thay đổi giá bạn trả.";

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
  perks,
  voucherAnchor,
  sellerId = null,
}: {
  sellerId?: string | null;
  offer: PricedOffer;
  perks: OfferPerk[];
  voucherAnchor: string | null;
  cheapestPrice: number | null;
  /** Several in-stock offers: badge the primary one as "Giá tốt nhất". */
  showBest: boolean;
  primary: boolean;
}) {
  const price = validPrice(offer.price);
  // Price after the best voucher combination, shipping not included (page-data keeps it fresh + lower).
  const effective = validPrice(offer.effectivePrice);
  const isBest = showBest && primary;
  const seller = offer.sellerName?.trim() || "Người bán chưa rõ tên";
  const rating = offer.sellerRating;
  const ratingCount = offer.sellerRatingCount;
  const hasRating = rating != null && Number.isFinite(rating) && rating > 0;
  const diffFromBest =
    !isBest && price != null && cheapestPrice != null && price > cheapestPrice
      ? price - cheapestPrice
      : null;

  return (
    <div
      className={`grid grid-cols-2 items-center gap-3 rounded-tile border p-4 transition-colors min-[761px]:grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,1.05fr)_minmax(9.5rem,auto)_176px] min-[761px]:gap-4 ${
        primary
          ? "border-primary/40 bg-primary-soft/35 ring-1 ring-primary/15"
          : "border-line bg-surface hover:border-line-strong/60"
      }`}
    >
      {/* Col 1: Seller / Shop. Phone: full width; rating/stock and perks share the next row. */}
      <div className="col-span-2 flex min-w-0 flex-col gap-1 min-[761px]:col-span-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <MarketplaceChip marketplace={offer.marketplace} />
          {offer.sellerIsOfficial && (
            <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-micro font-semibold text-primary">
              Chính hãng
            </span>
          )}
          {isBest && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-micro font-semibold text-on-primary">
              <CheckCircleIcon className="size-3" strokeWidth={2.5} />
              Giá tốt nhất
            </span>
          )}
        </div>
        {sellerId ? (
          <Link
            href={`/seller/${sellerId}`}
            className="truncate text-body-sm font-semibold text-ink underline-offset-2 hover:underline"
            title={`Hồ sơ giá của ${seller}`}
          >
            {seller}
          </Link>
        ) : (
          <span className="truncate text-body-sm font-semibold text-ink" title={seller}>
            {seller}
          </span>
        )}
      </div>

      {/* Col 2: Rating & Stock */}
      <div className="flex flex-col gap-0.5 text-label text-ink-2">
        <div>
          {hasRating ? (
            <span className="inline-flex items-center gap-1">
              <b className="num font-bold text-ink">{rating.toFixed(1).replace(".", ",")} ★</b>
              {ratingCount != null && ratingCount > 0 && <span className="text-ink-3">({formatCount(ratingCount)})</span>}
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

      {/* Col 3: Perks (flash sale, free shipping, voucher) — only from data */}
      <div className="text-label text-ink-2">
        {perks.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {perks.map((p) => (
              <PerkChip key={p.kind} perk={p} voucherAnchor={voucherAnchor} />
            ))}
          </div>
        ) : offer.sellerIsOfficial ? (
          <span className="font-medium text-ink-2">Gian hàng chính hãng</span>
        ) : (
          <span className="text-ink-3" aria-label="Không có ưu đãi">
            —
          </span>
        )}
      </div>

      {/* Col 4: Price & Diff */}
      <div className="col-span-2 flex flex-col items-start gap-0.5 min-[761px]:col-span-1 min-[761px]:items-end">
        {price != null ? (
          <span className="num text-price-row font-bold tracking-tight text-ink">
            {formatVnd(price)}
          </span>
        ) : (
          <span className="text-body-sm font-medium text-ink-3">Chưa có giá</span>
        )}
        {price != null && effective != null && effective < price && (
          <span className="flex flex-wrap items-center gap-1 text-micro font-semibold text-ink-2 min-[761px]:justify-end">
            <span className="whitespace-nowrap">
              <span className="num">~{formatVnd(effective)}</span> sau voucher
            </span>
            <span className="rounded-full border border-dashed border-line-strong px-1.5 text-nano font-semibold text-ink-3">
              Ước tính
            </span>
          </span>
        )}
        {diffFromBest != null && (
          <span className="num text-nano font-medium text-ink-3">
            +{formatVnd(diffFromBest)}
          </span>
        )}
      </div>

      {/* Col 5: CTA Button */}
      <div className="col-span-2 min-[761px]:col-span-1">
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

export function OfferList({ offers, bestBuyId, offerVouchers, voucherAnchor = VOUCHER_SECTION_ID, offerSellers }: OfferListProps) {
  const list = offers ?? [];

  if (list.length === 0) {
    return (
      <section aria-labelledby="offers-heading" className={OFFER_CARD}>
        <h2 id="offers-heading" className="display text-h3 font-semibold text-ink">
          So giá nơi bán
        </h2>
        <p className="rounded-tile border border-dashed border-line-strong p-5 text-body-sm text-ink-3">
          Chưa có nơi bán nào được theo dõi cho phiên bản này.
        </p>
      </section>
    );
  }

  const priced = list.filter((o) => o.inStock && validPrice(o.price) != null);
  const cheapestPrice = priced.length > 0 ? Math.min(...priced.map((o) => o.price as number)) : null;
  const primaryId =
    (bestBuyId && priced.some((o) => o.offerId === bestBuyId) ? bestBuyId : null) ??
    priced.find((o) => o.price === cheapestPrice)?.offerId ??
    null;
  const showBest = priced.length > 1;
  const head = list.slice(0, VISIBLE_ROWS);
  const rest = list.slice(VISIBLE_ROWS);

  return (
    <section aria-labelledby="offers-heading" className={OFFER_CARD}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="offers-heading" className="display text-h3 font-bold text-ink sm:text-h2-sm">
            So giá {list.length} nơi bán
          </h2>
          <span className="text-label text-ink-3">
            Đã gom các gian hàng bán cùng mẫu, cùng phân loại · xếp từ giá thấp nhất
          </span>
        </div>
        {cheapestPrice != null && (
          <span className="rounded-full bg-accent px-3 py-1 text-label font-semibold text-on-accent">
            Từ <span className="num font-bold">{formatVnd(cheapestPrice)}</span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div
          aria-hidden="true"
          className="eyebrow hidden grid-cols-[minmax(0,1.5fr)_minmax(0,0.85fr)_minmax(0,1.05fr)_minmax(9.5rem,auto)_176px] gap-4 px-4 pb-1 text-ink-3 min-[761px]:grid"
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
              sellerId={offerSellers?.[offer.offerId] ?? null}
              key={offer.offerId}
              offer={offer}
              cheapestPrice={cheapestPrice}
              showBest={showBest}
              primary={offer.offerId === primaryId}
              perks={offerPerks(offer, offerVouchers?.[offer.offerId] ?? [])}
              voucherAnchor={voucherAnchor}
            />
          ))}
        </div>

        {rest.length > 0 && (
          <details className="group pt-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-center rounded-full border border-line text-label font-semibold text-ink hover:border-primary/40 hover:text-primary [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">Xem thêm {rest.length} nơi bán khác</span>
              <span className="hidden group-open:inline">Thu gọn danh sách</span>
            </summary>
            <div className="mt-2.5 flex flex-col gap-2.5">
              {rest.map((offer) => (
                <OfferRow
              sellerId={offerSellers?.[offer.offerId] ?? null}
                  key={offer.offerId}
                  offer={offer}
                  cheapestPrice={cheapestPrice}
                  showBest={showBest}
                  primary={offer.offerId === primaryId}
                  perks={offerPerks(offer, offerVouchers?.[offer.offerId] ?? [])}
                  voucherAnchor={voucherAnchor}
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
