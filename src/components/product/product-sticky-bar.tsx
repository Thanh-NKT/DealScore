"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { formatVnd } from "@/lib/format";
import type { Recommendation } from "@/lib/pricing/deal-score";
import { verdictText } from "./verdict-tag";
import { BellIcon, ImageMissingIcon } from "@/components/ui/icons";
import { marketplaceStyle } from "./marketplace";

interface ProductStickyBarProps {
  productName: string;
  variantTitle?: string;
  price: number | null;
  score?: number | null;
  recommendation?: Recommendation | null;
  image?: string | null;
  buyUrl?: string | null;
  buyLabel?: string;
  marketplace?: string | null;
  /** The buy link carries our affiliate id: the disclosure sits next to it, on every screen width. */
  affiliate?: boolean;
  isWatching?: boolean;
  onToggleWatch?: () => void;
  /** Id of the main buy area; the bar only shows once that area has scrolled out above the viewport. */
  anchorId?: string;
}

const VERDICT_TONE: Record<Recommendation, string> = {
  buy: "text-buy",
  wait: "text-wait",
  avoid: "text-avoid",
  insufficient_data: "text-ink-3",
};

export function ProductStickyBar({
  productName,
  variantTitle,
  price,
  score,
  recommendation,
  image,
  buyUrl,
  buyLabel = "Mua ngay",
  marketplace,
  affiliate = false,
  isWatching = false,
  onToggleWatch,
  anchorId,
}: ProductStickyBarProps) {
  // With an anchor, the bar only appears after the main buy button has scrolled away, so two
  // buy buttons never show at once. Without one it is always on.
  const [shown, setShown] = useState(!anchorId);
  useEffect(() => {
    const el = anchorId ? document.getElementById(anchorId) : null;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      setShown(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [anchorId]);

  if (price == null || !Number.isFinite(price) || price <= 0) return null;
  const mBtn = marketplaceStyle(marketplace).primaryBtn;

  return (
    <aside
      aria-label="Hành động nhanh"
      aria-hidden={!shown}
      inert={!shown}
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-lift backdrop-blur-md transition-[translate,opacity] duration-200 ease-out sm:px-6 lg:px-14 ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-3.5">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-inner border border-line bg-surface-2">
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
            <span className="max-w-[200px] truncate text-label font-bold text-ink sm:max-w-[320px]">
              {variantTitle || productName}
            </span>
            <span className="num display text-title font-extrabold leading-tight tracking-tight text-ink">
              {formatVnd(price)}
            </span>
            {recommendation && (
              <span className={`text-micro font-semibold ${VERDICT_TONE[recommendation]}`}>
                {score != null && recommendation !== "insufficient_data" ? `${Math.round(score)} điểm · ` : ""}
                {verdictText(recommendation)}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          {onToggleWatch && (
            <button
              type="button"
              onClick={onToggleWatch}
              aria-pressed={isWatching}
              className={`hidden h-11 items-center gap-1.5 rounded-md border px-4 text-label font-bold transition-colors md:inline-flex cursor-pointer ${
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
            <div className="flex flex-col items-center gap-0.5">
              <a
                href={buyUrl}
                target="_blank"
                rel="sponsored nofollow noopener"
                className={`flex h-11 items-center gap-2 rounded-md px-4 text-body-sm font-bold transition-colors sm:px-5 ${mBtn}`}
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
              {affiliate && <span className="text-micro text-ink-3">Liên kết tiếp thị</span>}
            </div>
          ) : (
            <button
              type="button"
              disabled
              className="flex h-11 cursor-not-allowed items-center gap-2 rounded-md bg-surface-2 px-4 text-body-sm font-bold text-ink-3 sm:px-5"
            >
              <span>Tạm hết hàng</span>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
