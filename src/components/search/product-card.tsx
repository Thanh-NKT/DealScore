import type { ReactNode } from "react";
import Link from "next/link";
import type { SearchItem } from "@/lib/search";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { discountPercent, formatVnd } from "@/lib/format";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { ProductImage } from "@/components/ui/product-image";
import { UpdatedAt } from "@/components/product/updated-at";
import { ClockIcon } from "@/components/ui/icons";
import { marketplaceName } from "@/components/product/marketplace";

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
        <span className="text-micro whitespace-nowrap text-ink-3 max-[240px]:hidden" aria-hidden="true">
          Deal Score
        </span>
        <ScoreRing score={score} recommendation={recommendation} size="sm" showBadge />
      </div>
    </div>
  );
}

/**
 * Product showcase card:
 * - Top stage: clean image frame with subtle hover zoom, floating brand pill (top-left) and the
 *   seller's list-price discount (top-right) — NEUTRAL: a card has no price history to verify it, and
 *   the solid buy chip is reserved for discounts the product page has checked (DESIGN.md).
 * - Middle: 2-line product title + optional discovery insight chip.
 * - Bottom hero capsule: Best Price + Savings on the left, SVG Deal Score Progress Ring + corner
 *   verdict badge on the right, followed by a compact freshness & CTA footer.
 */
export function ProductCard({ item, href, categoryName, insight }: ProductCardProps) {
  const { slug, canonicalName, brand, image, categorySlug, score, recommendation, lastObservedAt } = item;
  const name = canonicalName?.trim() || "Sản phẩm chưa có tên";
  const price = validPrice(item.bestPrice);
  const listed = validPrice(item.originalPrice);
  const effective = validPrice(item.effectivePrice);
  const off = discountPercent(price, listed);
  const brandName = brand?.trim() || categoryName?.trim();
  const where = item.marketplace ? marketplaceName(item.marketplace) : null;

  return (
    <Link
      href={href ?? `/${categorySlug}/${slug}`}
      title={name}
      className="@container group flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface p-3.5 text-ink transition-all duration-200 ease-out hover:-translate-y-1 hover:border-primary/45 hover:shadow-lift"
    >
      {/* 1. Product Image Stage */}
      <div className="relative h-[204px] w-full shrink-0 overflow-hidden rounded-tile border border-line/60 bg-surface-2">
        <ProductImage
          src={image}
          className="size-full p-4"
          imgClassName="transition-transform duration-300 ease-out group-hover:scale-105"
          iconClassName="size-14 text-ink-3/60"
        />

        {/* Top-left Brand Pill */}
        {brandName ? (
          <span className="absolute left-2.5 top-2.5 max-w-[65%] truncate rounded-full border border-line/80 bg-surface/92 px-2.5 py-1 text-nano font-bold text-ink-2 backdrop-blur-md shadow-2xs">
            {brandName}
          </span>
        ) : null}

        {/* Top-right: the seller's list-price discount, neutral (not verified on a card) */}
        {off != null && off > 0 && (
          <span
            className="num absolute right-2.5 top-2.5 rounded-full border border-line/80 bg-surface/92 px-2.5 py-1 text-micro font-bold text-ink-2 backdrop-blur-md shadow-2xs"
            title="Mức giảm so với giá niêm yết do người bán ghi"
          >
            −{off}%
          </span>
        )}
      </div>

      {/* 2. Product Title & Discovery Signal */}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-0.5">
        <h3 className="line-clamp-2 min-h-[42px] text-control font-semibold leading-[1.38] text-ink [overflow-wrap:anywhere] transition-colors group-hover:text-primary">
          {name}
        </h3>

        {insight && (
          <div className="flex items-center gap-1.5 rounded-sm border border-primary/15 bg-primary-soft/45 px-2.5 py-1.5 text-micro font-semibold text-ink">
            <span aria-hidden="true" className="shrink-0 [&>svg]:size-3.5">
              {insight.icon}
            </span>
            <span className="truncate">{insight.text}</span>
          </div>
        )}

        {/* 3. Signature DealScore Price + Deal Score Capsule: the verdict words sit on top so the ring never stands alone */}
        <div className="mt-auto flex flex-col gap-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <VerdictTag recommendation={score == null ? null : recommendation} />
            {item.isFlashSale && price != null && (
              <span className="inline-flex items-center gap-1 rounded-sm border border-wait/30 bg-wait-soft px-2 py-0.5 text-micro font-semibold text-wait">
                <ClockIcon className="size-3.5" />
                Giá flash sale
              </span>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-line/80 bg-surface-2/45 p-3 transition-colors group-hover:border-primary/25 group-hover:bg-surface-2/75">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-micro font-medium text-ink-3">Giá tốt nhất hiện tại</span>

              {price != null ? (
                <span className="num truncate text-h3 font-extrabold leading-tight tracking-tight text-ink">
                  {formatVnd(price)}
                </span>
              ) : (
                <span className="text-body-sm font-semibold leading-tight text-ink-3">Chưa có giá</span>
              )}

              {price != null && effective != null && effective < price && (
                <span className="flex flex-wrap items-center gap-1 text-micro font-semibold text-ink-2">
                  <span>
                    ~<span className="num">{formatVnd(effective)}</span> sau voucher
                  </span>
                  <span className="rounded-sm border border-dashed border-line-strong px-1.5 text-nano font-bold text-ink-3">
                    Ước tính
                  </span>
                </span>
              )}

              {off != null && listed != null ? (
                <span className="flex items-center gap-1.5 text-micro text-ink-3">
                  <span>Giá niêm yết</span>
                  <s className="num decoration-[1.5px]">{formatVnd(listed)}</s>
                </span>
              ) : where ? (
                <span className="text-micro text-ink-3">Ghi nhận trên {where}</span>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col items-center gap-0.5">
              <ScoreRing score={score} recommendation={recommendation} size="sm" showBadge />
              <span className="text-nano font-semibold text-ink-3" aria-hidden="true">Deal Score</span>
            </div>
          </div>

          {/* 4. Compact Footer: Timestamp + Hover Action */}
          <div className="flex items-center justify-between gap-2 px-0.5 text-micro text-ink-3">
            {lastObservedAt ? (
              <span className="inline-flex min-w-0 items-center gap-1 truncate">
                <ClockIcon className="size-3.5 shrink-0 text-ink-3" />
                <UpdatedAt iso={lastObservedAt} variant="compact" />
              </span>
            ) : (
              <span>Đang theo dõi giá</span>
            )}
            <span className="shrink-0 font-semibold text-primary transition-transform duration-150 group-hover:translate-x-0.5">
              Xem giá →
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
