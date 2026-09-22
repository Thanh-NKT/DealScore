import type { PricedOffer } from "@/lib/variant-pricing";
import { formatVnd } from "@/lib/format";
import { UpdatedAt } from "./updated-at";

interface PriceSummaryProps {
  cheapest: PricedOffer | null;
  offerCount: number;
  updatedAt?: string | null;
  isStale?: boolean;
}

export function PriceSummary({
  cheapest,
  offerCount,
  updatedAt,
  isStale = false,
}: PriceSummaryProps) {
  if (!cheapest || cheapest.price == null) {
    return (
      <div className="rounded-xl border border-border p-4 text-sm text-muted">
        Chưa có dữ liệu giá cho phiên bản này.
      </div>
    );
  }

  // Nếu tất cả đều hết hàng
  if (!cheapest.inStock) {
    return (
      <div className="space-y-1">
        <div className="flex items-baseline gap-3">
          <span className="text-xl font-bold text-rec-avoid">Tạm hết hàng</span>
          <span className="text-sm text-muted">
            Giá lần cuối: {formatVnd(cheapest.price)}
          </span>
        </div>
        {updatedAt && (
          <div className="text-xs text-muted">
            Ghi nhận lúc: <UpdatedAt iso={updatedAt} isStale={isStale} />
          </div>
        )}
      </div>
    );
  }

  const { price, originalPrice, discountPercent } = cheapest;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          {formatVnd(price)}
        </div>

        {discountPercent !== null && originalPrice != null && (
          <div className="flex items-center gap-2">
            <s className="text-base text-muted sm:text-lg">
              {formatVnd(originalPrice)}
            </s>
            <span className="rounded-md bg-rec-avoid-bg px-2 py-0.5 text-xs font-bold text-rec-avoid">
              −{discountPercent}%
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <span>Từ {offerCount} người bán đang theo dõi</span>
        {updatedAt && (
          <>
            <span>•</span>
            <UpdatedAt iso={updatedAt} isStale={isStale} />
          </>
        )}
      </div>
    </div>
  );
}
