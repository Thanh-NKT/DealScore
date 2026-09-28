"use client";

import Image from "next/image";
import { formatVnd } from "@/lib/format";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { ScoreRing } from "./verdict-tag";
import { BellIcon, ImageMissingIcon } from "@/components/ui/icons";
import { marketplaceStyle } from "./marketplace";

interface ProductStickyBarProps {
  productName: string;
  variantTitle?: string;
  price: number | null;
  listPrice?: number | null;
  discountPercent?: number | null;
  score?: number | null;
  recommendation?: Recommendation | null;
  image?: string | null;
  buyUrl?: string | null;
  buyLabel?: string;
  marketplace?: string | null;
  isWatching?: boolean;
  onToggleWatch?: () => void;
}

export function ProductStickyBar({
  productName,
  variantTitle,
  price,
  listPrice,
  discountPercent,
  score,
  recommendation,
  image,
  buyUrl,
  buyLabel = "Mua ngay",
  marketplace,
  isWatching = false,
  onToggleWatch,
}: ProductStickyBarProps) {
  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const mBtn = marketplaceStyle(marketplace).primaryBtn;

  return (
    <aside
      aria-label="Hành động nhanh"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-2.5 shadow-lift backdrop-blur-md sm:px-6 lg:px-14"
    >
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-surface-2">
            {image ? (
              <Image
                src={image}
                alt=""
                width={44}
                height={44}
                className="size-full object-contain p-1"
                unoptimized
              />
            ) : (
              <ImageMissingIcon className="size-5 text-ink-3" />
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            <span className="max-w-[200px] truncate text-[13px] font-bold text-ink sm:max-w-[320px]">
              {variantTitle || productName}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="num display text-[18px] font-extrabold tracking-tight text-ink">
                {formatVnd(price)}
              </span>
              {listPrice && listPrice > price && (
                <span className="num text-[12px] text-ink-3 line-through">
                  {formatVnd(listPrice)}
                </span>
              )}
              {discountPercent != null && discountPercent > 0 && (
                <span className="num rounded-xs bg-buy-soft px-1.5 py-0.5 text-[11px] font-bold text-buy">
                  −{discountPercent}%
                </span>
              )}
            </div>
          </div>

          <div className="hidden pl-2 sm:block">
            <ScoreRing score={score} recommendation={recommendation} size="sm" showBadge />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {onToggleWatch && (
            <button
              type="button"
              onClick={onToggleWatch}
              aria-pressed={isWatching}
              className={`hidden h-11 items-center gap-1.5 rounded-xl border px-4 text-[13px] font-bold transition-colors md:inline-flex cursor-pointer ${
                isWatching
                  ? "border-accent bg-accent text-on-accent"
                  : "border-primary/35 bg-primary-soft/65 text-primary hover:bg-primary-soft"
              }`}
            >
              <BellIcon className="size-4" strokeWidth={2.2} />
              <span>{isWatching ? "Đang theo dõi" : "Theo dõi giá"}</span>
            </button>
          )}

          {buyUrl ? (
            <a
              href={buyUrl}
              target="_blank"
              rel="sponsored nofollow noopener"
              className={`flex h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-bold transition-colors sm:px-5 ${mBtn}`}
            >
              <span>{buyLabel}</span>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="flex h-11 cursor-not-allowed items-center gap-2 rounded-xl bg-surface-2 px-4 text-[14px] font-bold text-ink-3 sm:px-5"
            >
              <span>Tạm hết hàng</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
