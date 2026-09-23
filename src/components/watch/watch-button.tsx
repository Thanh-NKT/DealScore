"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WatchModal } from "@/components/watch/watch-modal";
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

export function WatchButton({
  isLoggedIn,
  productName,
  variantKey,
  variantId,
  currentPrice,
  existingWatch,
  currentPath,
}: WatchButtonProps) {
  const router = useRouter();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleClick = () => {
    if (!isLoggedIn) {
      router.push(`/dang-nhap?next=${encodeURIComponent(currentPath)}`);
    } else {
      setIsModalOpen(true);
    }
  };

  const isWatched = existingWatch?.status === "active";

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
          isWatched
            ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
            : "border border-border bg-background text-foreground hover:bg-black/5 dark:hover:bg-white/5"
        }`}
      >
        <span>{isWatched ? "✓" : "🔔"}</span>
        <span>{isWatched ? "Đang theo dõi" : "Theo dõi giá"}</span>
      </button>

      {isLoggedIn && (
        <WatchModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
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
