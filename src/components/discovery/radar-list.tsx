import Link from "next/link";
import type { SVGProps } from "react";
import type { RadarItem } from "@/lib/discovery";
import { formatVnd } from "@/lib/format";
import { ProductImage } from "@/components/ui/product-image";
import { ScoreRing } from "@/components/product/verdict-tag";

function ArrowDown(p: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

/** A price of 0 or below is a marketplace data error, not a free product: treat it as missing. */
const validPrice = (v: number | null | undefined) => (v != null && Number.isFinite(v) && v > 0 ? v : null);

/**
 * Rows of the Price Drop Radar, drawn inside a night panel (DESIGN.md "Radar giảm giá"): thumbnail,
 * name + category, the real drop against the recorded 30-day median (buy chip, arrow + words), the
 * current price, then the verdict words beside the Deal Score ring. Phones stack the numbers under
 * the name. Every row links to the variant that dropped.
 */
export function RadarList({
  items,
  categoryNames,
}: {
  items: RadarItem[];
  /** slug → display name; unknown slugs simply show no category line. */
  categoryNames: Record<string, string>;
}) {
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-tile border border-line bg-surface">
      {items.map((item) => {
        const name = item.canonicalName?.trim() || "Sản phẩm chưa có tên";
        const price = validPrice(item.bestPrice);
        const median = validPrice(item.median30d);
        const pct = Math.round(item.dropPct * 100);
        const meta = [categoryNames[item.categorySlug], item.brand?.trim()].filter(Boolean).join(" · ");
        return (
          <li key={`${item.productId}-${item.variantId}`}>
            <Link
              href={`/${item.categorySlug}/${item.slug}?variant=${item.variantId}`}
              title={name}
              className="group grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 px-4 py-3.5 text-ink transition-colors duration-150 ease-out hover:bg-surface-2/50 md:grid-cols-[56px_minmax(0,1fr)_150px_140px_64px]"
            >
              <div className="size-14 overflow-hidden rounded-inner bg-surface-2/70">
                <ProductImage src={item.image} className="p-1.5" imgClassName="mix-blend-multiply dark:mix-blend-normal" iconClassName="size-5 text-ink-3/50" />
              </div>

              <div className="min-w-0">
                <p className="line-clamp-1 text-control font-semibold leading-[1.35] text-ink group-hover:underline group-hover:underline-offset-2">{name}</p>
                {meta && <p className="truncate text-micro leading-[1.45] text-ink-3">{meta}</p>}
              </div>

              {/* Phones: one wrapped line under the name; md+: these become grid cells. */}
              <div className="col-start-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 md:contents">
                <div className="flex flex-col items-start gap-1">
                  {pct > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-buy py-0.5 pl-1.5 pr-2 text-micro font-bold text-canvas">
                      <ArrowDown className="size-3.5" />
                      <span className="sr-only">Thấp hơn </span>
                      <span className="num">{pct}%</span>
                    </span>
                  ) : null}
                  <span className="whitespace-nowrap text-micro leading-[1.3] text-ink-3">so với trung vị 30 ngày</span>
                </div>

                <div className="flex flex-col items-end gap-0.5 text-right">
                  {price != null ? (
                    <span className="num whitespace-nowrap text-num-sm font-bold leading-tight text-ink">{formatVnd(price)}</span>
                  ) : (
                    <span className="text-body-sm font-semibold text-ink-3">Chưa có giá</span>
                  )}
                  {median != null && (
                    <span className="whitespace-nowrap text-micro leading-[1.3] text-ink-3">
                      TB <span className="num line-through decoration-ink-3/60">{formatVnd(median)}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end">
                  <ScoreRing
                    score={item.score}
                    recommendation={item.recommendation}
                    size="sm"
                    showBadge
                  />
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
