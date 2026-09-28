"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { WatchModal } from "@/components/watch/watch-modal";
import { formatVnd } from "@/lib/format";
import { BellIcon, BellOffIcon } from "@/components/ui/icons";
import type { WatchConfig } from "@/lib/watch/types";

interface WatchButtonProps {
  isLoggedIn: boolean;
  productName: string;
  variantKey: string;
  variantId: string;
  currentPrice: number | null;
  existingWatch?: {
    id: string;
    config: WatchConfig;
    status: string;
  } | null;
  currentPath: string;
}

const BTN =
  "inline-flex h-13 w-full items-center justify-center gap-2 whitespace-nowrap rounded-md border px-5 text-control font-bold transition-colors duration-150 ease-out cursor-pointer";
const IDLE = "border-wait/35 bg-wait-soft/80 text-wait hover:bg-wait-soft";
const WATCHING = "border-accent bg-accent text-on-accent hover:opacity-92";
const PAUSED = "border-line-strong bg-surface-2 text-ink-2 hover:bg-surface";

/**
 * Entry point to a Watch on the product detail page.
 * Uses BellIcon for consistency with the Watch page and keeps a fixed 54px height
 * so it aligns horizontally with BuyButton and ShareButton.
 */
export function WatchButton({
  isLoggedIn,
  productName,
  variantKey,
  variantId,
  currentPrice,
  existingWatch,
  currentPath,
}: WatchButtonProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!isLoggedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(currentPath)}`}
        title="Đăng nhập để nhận thông báo khi giá giảm"
        className={`${BTN} ${IDLE}`}
      >
        <BellIcon className="size-4.5 shrink-0" strokeWidth={2.2} />
        <span>Theo dõi giá</span>
      </Link>
    );
  }

  const status = existingWatch?.status;
  const target = existingWatch?.config.targetPrice ?? null;

  const label =
    status === "active"
      ? target != null
        ? `Đang báo ≤ ${formatVnd(target)}`
        : "Đang theo dõi giá"
      : status === "paused"
        ? "Đã tạm dừng báo giá"
        : status === "done"
          ? "Đặt lại theo dõi"
          : "Theo dõi giá";

  const styleClass = status === "active" ? WATCHING : status === "paused" ? PAUSED : IDLE;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title={
          status === "active"
            ? "Bấm để chỉnh giá mong muốn hoặc điều kiện báo"
            : "Đặt mức giá mong muốn để nhận thông báo"
        }
        className={`${BTN} ${styleClass}`}
      >
        {status === "paused" ? (
          <BellOffIcon className="size-4.5 shrink-0" strokeWidth={2.2} />
        ) : (
          <BellIcon className="size-4.5 shrink-0" strokeWidth={2.2} />
        )}
        <span className="truncate">{label}</span>
      </button>

      {open && (
        <WatchModal
          isOpen
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          productName={productName}
          variantKey={variantKey}
          variantId={variantId}
          currentPrice={currentPrice}
          existingWatch={existingWatch}
          currentPath={currentPath}
        />
      )}
    </>
  );
}
