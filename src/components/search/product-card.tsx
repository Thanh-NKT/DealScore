import Link from "next/link";
import type { SearchItem } from "@/lib/search";
import { formatVnd } from "@/lib/format";
import { RECOMMENDATION_LABEL } from "@/lib/pricing/deal-score";

interface ProductCardProps {
  item: SearchItem;
}

export function ProductCard({ item }: ProductCardProps) {
  const { slug, canonicalName, brand, image, categorySlug, bestPrice, originalPrice, score, recommendation } = item;

  const colorMap = {
    buy: "text-rec-buy bg-rec-buy-bg",
    wait: "text-rec-wait bg-rec-wait-bg",
    avoid: "text-rec-avoid bg-rec-avoid-bg",
    insufficient_data: "text-rec-unknown bg-rec-unknown-bg",
  };

  const badgeColor = recommendation ? colorMap[recommendation] : colorMap.insufficient_data;
  const label = recommendation ? RECOMMENDATION_LABEL[recommendation] : "⚪ Chưa đủ dữ liệu";

  return (
    <Link
      href={`/${categorySlug}/${slug}`}
      className="group flex flex-col justify-between rounded-2xl border border-border bg-background p-4 transition hover:border-foreground/40 hover:shadow-md"
    >
      <div className="space-y-3">
        {/* Ảnh sản phẩm */}
        <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-border bg-black/[0.02] dark:bg-white/[0.02]">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image}
              alt={canonicalName}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted">
              Kairo
            </div>
          )}
        </div>

        {/* Thông tin thương hiệu + tên */}
        <div>
          {brand && (
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">
              {brand}
            </div>
          )}
          <h3 className="line-clamp-2 text-sm font-semibold text-foreground group-hover:text-foreground/80">
            {canonicalName}
          </h3>
        </div>
      </div>

      {/* Giá + Điểm Deal Score */}
      <div className="mt-4 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-base font-extrabold text-foreground">
              {bestPrice != null ? formatVnd(bestPrice) : "Chưa có giá"}
            </div>
            {originalPrice != null && bestPrice != null && originalPrice > bestPrice && (
              <div className="text-[11px] text-muted">
                <s>{formatVnd(originalPrice)}</s>
              </div>
            )}
          </div>

          <div
            className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold ${badgeColor}`}
            title={label}
          >
            {score != null ? (
              <>
                <span>{score}</span>
                <span className="text-[9px] opacity-80">/100</span>
              </>
            ) : (
              <span className="text-[10px]">⚪ Thiếu dữ liệu</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
