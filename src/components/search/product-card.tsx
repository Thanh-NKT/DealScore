import type { ReactNode } from "react";
import Link from "next/link";
import type { SearchItem } from "@/lib/search";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { discountPercent, formatVnd } from "@/lib/format";
import { ScoreRing, VerdictTag } from "@/components/product/verdict-tag";
import { ProductImage } from "@/components/ui/product-image";
import { UpdatedAt } from "@/components/product/updated-at";
import { ClockIcon, TrendDownIcon } from "@/components/ui/icons";

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
        <span className="text-[12px] whitespace-nowrap text-ink-3 max-[240px]:hidden" aria-hidden="true">
          Deal Score
        </span>
        <ScoreRing score={score} recommendation={recommendation} size="sm" showBadge />
      </div>
    </div>
  );
}

/**
 * Product showcase card:
 * - Top stage: clean image frame with subtle hover zoom, floating brand/offer pill (top-left) and
 *   discount badge (top-right).
 * - Middle: 2-line product title + optional discovery insight chip.
 * - Bottom hero capsule: Best Price + Savings on the left, SVG Deal Score Progress Ring + corner
 *   verdict badge on the right, followed by a compact freshness & CTA footer.
 */
export function ProductCard({ item, href, categoryName, insight }: ProductCardProps) {
  const { slug, canonicalName, brand, image, categorySlug, score, recommendation, lastObservedAt } = item;
  const name = canonicalName?.trim() || "Sản phẩm chưa có tên";
  const price = validPrice(item.bestPrice);
  const listed = validPrice(item.originalPrice);
  const off = discountPercent(price, listed);
  const saved = price != null && listed != null && listed > price ? listed - price : null;
  const brandName = brand?.trim() || categoryName?.trim();
  const offersCount = (item as unknown as { offerCount?: number }).offerCount;

  return (
    <Link
      href={href ?? `/${categorySlug}/${slug}`}
      title={name}
      className="@container group flex min-w-0 flex-col gap-3 rounded-[20px] border border-line bg-surface p-3.5 text-ink transition-all duration-200 ease-out hover:-translate-y-1 hover:border-primary/45 hover:shadow-lift"
    >
      {/* 1. Product Image Stage */}
      <div className="relative h-[204px] w-full shrink-0 overflow-hidden rounded-[14px] border border-line/60 bg-surface-2">
        <ProductImage
          src={image}
          className="size-full p-4"
          imgClassName="transition-transform duration-300 ease-out group-hover:scale-105"
          iconClassName="size-14 text-ink-3/60"
        />

        {/* Top-left Brand / Multi-offer Pill */}
        {offersCount && offersCount > 1 ? (
          <span className="absolute left-2.5 top-2.5 rounded-full border border-line/80 bg-surface/92 px-2.5 py-1 text-[11px] font-bold text-ink-2 backdrop-blur-md shadow-2xs">
            Đã gom {offersCount} nơi bán
          </span>
        ) : brandName ? (
          <span className="absolute left-2.5 top-2.5 max-w-[65%] truncate rounded-full border border-line/80 bg-surface/92 px-2.5 py-1 text-[11px] font-bold text-ink-2 backdrop-blur-md shadow-2xs">
            {brandName}
          </span>
        ) : null}

        {/* Top-right Discount Badge */}
        {off != null && off > 0 && (
          <span className="num absolute right-2.5 top-2.5 inline-flex items-center gap-0.5 rounded-full bg-buy px-2.5 py-1 text-[12px] font-extrabold text-canvas shadow-xs">
            <TrendDownIcon className="size-3" strokeWidth={2.6} />
            −{off}%
          </span>
        )}
      </div>

      {/* 2. Product Title & Discovery Signal */}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-0.5">
        <h3 className="line-clamp-2 min-h-[42px] text-[15px] font-semibold leading-[1.38] text-ink [overflow-wrap:anywhere] transition-colors group-hover:text-primary">
          {name}
        </h3>

        {insight && (
          <div className="flex items-center gap-1.5 rounded-[8px] border border-primary/15 bg-primary-soft/45 px-2.5 py-1.5 text-[12px] font-semibold text-ink">
            <span aria-hidden="true" className="shrink-0 [&>svg]:size-3.5">
              {insight.icon}
            </span>
            <span className="truncate">{insight.text}</span>
          </div>
        )}

        {/* 3. Signature Kairo Price + Deal Score Capsule */}
        <div className="mt-auto flex flex-col gap-2 pt-0.5">
          <div className="flex items-center justify-between gap-3 rounded-[12px] border border-line/80 bg-surface-2/45 p-3 transition-colors group-hover:border-primary/25 group-hover:bg-surface-2/75">
            <div className="flex min-w-0 flex-col gap-0.5">
              {saved != null && saved > 0 ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-buy">
                  Tiết kiệm <span className="num">{formatVnd(saved)}</span>
                </span>
              ) : (
                <span className="text-[11px] font-medium text-ink-3">Giá tốt nhất hiện tại</span>
              )}

              {price != null ? (
                <span className="num truncate text-[22px] font-extrabold leading-tight tracking-tight text-ink">
                  {formatVnd(price)}
                </span>
              ) : (
                <span className="text-[14px] font-semibold leading-tight text-ink-3">Chưa có giá</span>
              )}

              {off != null && listed != null ? (
                <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                  <span>Giá gốc</span>
                  <s className="num decoration-[1.5px]">{formatVnd(listed)}</s>
                </span>
              ) : (
                <span className="text-[11px] text-ink-3">Ghi nhận trên Shopee</span>
              )}
            </div>

            <div className=" flex shrink-0 flex-col items-center gap-0.5">
              <ScoreRing score={score} recommendation={recommendation} size="sm" showBadge />
            </div>
          </div>

          {/* 4. Compact Footer: Timestamp + Hover Action */}
          <div className="flex items-center justify-between gap-2 px-0.5 text-[12px] text-ink-3">
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
