import { unitPriceLabel } from "@/components/product/unit-price";
import type { ReactNode } from "react";
import Link from "next/link";
import type { SearchItem } from "@/lib/search";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { discountPercent, formatVnd } from "@/lib/format";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { ProductImage } from "@/components/ui/product-image";
import { UpdatedAt } from "@/components/product/updated-at";
import { ClockIcon, InfoIcon } from "@/components/ui/icons";
import { cardSourceLine, fakeSaleNote } from "@/components/search/card-lines";
import { marketplaceName } from "@/components/product/marketplace";
import { MarketplaceMark } from "@/components/product/marketplace-mark";

interface ProductCardProps {
  item: SearchItem;
  /** Link target; defaults to the product page. Radar links straight to the variant that dropped. */
  href?: string;
  /** Optional category display name when brand is absent. */
  categoryName?: string;
  /**
   * One line under the title saying why this card is on a discovery list, e.g.
   * "Thấp hơn 18% so với trung vị 30 ngày".
   */
  insight?: { icon: ReactNode; text: string };
  /** Position on a ranked list (Xu hướng): shown as an ink chip before the brand. */
  rank?: number;
}

/** A price of 0 or below is a marketplace data error, not a free product: treat it as missing. */
function validPrice(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

export function VerdictRow({
  score,
  recommendation,
}: {
  score: number | null | undefined;
  recommendation: Recommendation | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <VerdictTag recommendation={recommendation} className="shrink-0" />
      <div className="flex items-center gap-2">
        <span className="eyebrow whitespace-nowrap text-ink-3 max-[240px]:hidden" aria-hidden="true">
          Deal Score
        </span>
        <ScoreRing score={score} recommendation={recommendation} size="sm" showBadge />
      </div>
    </div>
  );
}

/**
 * Product card:
 * - A full-bleed image with the brand (top-left), the seller's list-price discount (top-right) —
 *   NEUTRAL: a card has no price history to verify it, so it is never shown as a saving — and the
 *   verdict pinned bottom-left so it reads before anything else.
 * - Title, then an optional discovery insight line.
 * - The price capsule: best price on the left, the Deal Score gauge on the right.
 * - A footer with the marketplace mark of that price, where it was seen and when.
 * Phones (< 640px, one card per row) get a row layout: a small image on the left, the verdict above
 * the title, so a screen shows three or four products instead of one and a half.
 */
export function ProductCard({ item, href, categoryName, insight, rank }: ProductCardProps) {
  const { slug, canonicalName, brand, image, categorySlug, score, recommendation, lastObservedAt } = item;
  const name = canonicalName?.trim() || "Sản phẩm chưa có tên";
  const price = validPrice(item.bestPrice);
  const listed = validPrice(item.originalPrice);
  const effective = validPrice(item.effectivePrice);
  const off = discountPercent(price, listed);
  const brandName = brand?.trim() || categoryName?.trim();
  const where = item.marketplace ? marketplaceName(item.marketplace) : null;
  const source = cardSourceLine(item.offerCount ?? null, where);
  // A cached fake-sale verdict for this exact price: the discount is the doubtful claim, so no "−X%" pill.
  const fakeNote = item.fakeSale && price != null ? fakeSaleNote(item.fakeSale, off) : null;

  return (
    <Link
      href={href ?? `/${categorySlug}/${slug}`}
      title={name}
      className="@container group flex min-w-0 overflow-hidden rounded-lg border border-line bg-surface text-ink transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-lift max-sm:flex-row sm:flex-col"
    >
      {/* 1. Image */}
      <div className="relative shrink-0 overflow-hidden border-line bg-surface-2/60 max-sm:w-[112px] max-sm:self-stretch max-sm:border-r sm:aspect-[4/3] sm:w-full sm:border-b">
        <ProductImage
          src={image}
          className="size-full p-7 max-sm:min-h-[112px] max-sm:p-2.5"
          imgClassName="mix-blend-multiply transition-transform duration-500 ease-out group-hover:scale-[1.05] dark:mix-blend-normal"
          iconClassName="size-12 text-ink-3/40"
        />

        {(brandName || rank != null) && (
          <span className="absolute left-3 top-3 flex max-w-[72%] items-center gap-1.5 max-sm:hidden">
            {rank != null && (
              <span className="num shrink-0 rounded-full bg-primary px-2 py-0.5 text-micro font-bold text-on-primary">
                <span className="sr-only">Hạng </span>#{rank}
              </span>
            )}
            {brandName && (
              <span className="eyebrow min-w-0 truncate rounded-full border border-line bg-surface/90 px-2 py-0.5 text-ink-2 backdrop-blur-sm">{brandName}</span>
            )}
          </span>
        )}

        {off != null && off > 0 && !fakeNote && (
          <span
            className="num absolute right-3 top-3 rounded-full border border-line bg-surface/90 px-2 py-0.5 text-micro font-bold text-ink-2 backdrop-blur-sm max-sm:left-2 max-sm:right-auto max-sm:top-2"
            title="Mức giảm so với giá niêm yết do người bán ghi"
          >
            −{off}%
          </span>
        )}

        <span className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-1.5 max-sm:hidden">
          <VerdictTag recommendation={score == null ? null : recommendation} className="shadow-sm" />
          {item.isFlashSale && price != null && (
            <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-wait-soft px-2.5 py-1 text-micro font-semibold text-wait shadow-sm">
              <ClockIcon className="size-3.5" />
              Giá flash sale
            </span>
          )}
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 max-sm:gap-2 max-sm:p-3">
        {/* Phones: rank, verdict and flash-sale label above the title (the image is too small to carry them). */}
        <div className="flex flex-wrap items-center gap-1.5 sm:hidden">
          {rank != null && (
            <span className="num shrink-0 rounded-full bg-primary px-2 py-0.5 text-micro font-bold text-on-primary">
              <span className="sr-only">Hạng </span>#{rank}
            </span>
          )}
          <VerdictTag recommendation={score == null ? null : recommendation} />
          {item.isFlashSale && price != null && (
            <span className="inline-flex min-h-7 items-center gap-1 rounded-full bg-wait-soft px-2.5 py-1 text-micro font-semibold text-wait">
              <ClockIcon className="size-3.5" />
              Giá flash sale
            </span>
          )}
          <ScoreRing score={score} recommendation={recommendation} size="sm" className="ml-auto" />
        </div>

        {/* 2. Title & discovery signal */}
        <h3 className="line-clamp-2 text-control font-semibold leading-[1.4] text-ink transition-colors [overflow-wrap:anywhere] group-hover:text-primary max-sm:text-body-sm sm:min-h-[42px]">
          {name}
        </h3>

        {insight && (
          <div className="flex items-center gap-1.5 text-micro font-semibold text-ink-2">
            <span aria-hidden="true" className="shrink-0 [&>svg]:size-3.5">
              {insight.icon}
            </span>
            <span className="truncate">{insight.text}</span>
          </div>
        )}

        {fakeNote && (
          <div title={fakeNote} className="flex flex-col gap-0.5 rounded-inner bg-wait-soft px-2.5 py-2">
            <span className="flex items-center gap-1.5 text-micro font-semibold text-wait">
              <InfoIcon className="size-3.5" />
              Giảm giá chưa thực chất
            </span>
            <span className="line-clamp-2 text-micro text-ink-2">{fakeNote}</span>
          </div>
        )}

        {/* 3. Price capsule + gauge */}
        <div className="mt-auto flex items-center justify-between gap-3 rounded-tile bg-surface-2/70 p-3 pl-3.5 max-sm:py-2.5">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="eyebrow text-ink-3 max-sm:hidden">Giá tốt nhất</span>
            {price != null ? (
              <span className="num truncate text-h3 font-bold leading-none tracking-tight text-ink max-sm:text-h4">{formatVnd(price)}</span>
            ) : (
              <span className="text-body-sm font-semibold leading-tight text-ink-3">Chưa có giá</span>
            )}

            {off != null && listed != null && (
              <span className="flex items-center gap-1.5 whitespace-nowrap text-micro text-ink-3">
                <span>Giá niêm yết</span>
                <s className="num decoration-[1.5px]">{formatVnd(listed)}</s>
              </span>
            )}

            {price != null && effective != null && effective < price && (
              <span className="flex flex-wrap items-center gap-1 text-micro font-semibold text-ink-2">
                <span className="whitespace-nowrap">
                  <span className="num">~{formatVnd(effective)}</span> sau voucher
                </span>
                <span className="rounded-full border border-dashed border-line-strong px-1.5 text-nano font-semibold text-ink-3">Ước tính</span>
              </span>
            )}
          </div>

          <ScoreRing score={score} recommendation={recommendation} size="md" className="max-sm:hidden" />
        </div>

        {/* 4. Footer: where (with the marketplace's mark) and when */}
        <div className="flex items-center gap-3 text-micro text-ink-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {item.marketplace && <MarketplaceMark marketplace={item.marketplace} size="sm" />}
            <div className="flex min-w-0 flex-col gap-0.5">
              {source && (
                <span className="sm:truncate">
                  {source.lead}
                  {source.count != null && <span className="num font-semibold text-ink-2">{source.count}</span>}
                  {source.tail}
                </span>
              )}
              {price != null && item.unitPrice ? <span className="num truncate">{unitPriceLabel(item.unitPrice)}</span> : null}
              {lastObservedAt ? (
                <span className="min-w-0 sm:truncate">
                  <UpdatedAt iso={lastObservedAt} variant="compact" icon />
                </span>
              ) : (
                <span>Đang theo dõi giá</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
