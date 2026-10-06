import { ExternalIcon, LinkIcon } from "@/components/ui/icons";
import { marketplaceName, marketplaceStyle } from "./marketplace";

interface BuyButtonProps {
  offerId: string;
  marketplace: string;
  /** Out of stock at this seller. */
  disabled?: boolean;
  /** false when the listing has no purchase URL: /go would 404, so don't send the shopper there. */
  hasLink?: boolean;
  /** The /go redirect carries our affiliate id: the disclosure must sit next to the button (DESIGN.md "Công bố affiliate"). */
  affiliate?: boolean;
  /** Primary for the main action of a group; other offer rows use secondary. */
  variant?: "primary" | "secondary";
  /** "lg" is the 52px button of the price card; "md" (44px) is for table rows and the sticky bar. */
  size?: "md" | "lg";
  /**
   * Show the short "Liên kết tiếp thị" label under the button. Turn it off only where the full
   * disclosure sentence sits directly under the button group.
   */
  affiliateLabel?: boolean;
  className?: string;
}

const BASE =
  "inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 font-semibold transition-colors duration-150 ease-out";
const SIZE = { md: "min-h-11 text-body-sm", lg: "min-h-13 text-body font-bold" } as const;

export function BuyButton({
  offerId,
  marketplace,
  disabled = false,
  hasLink = true,
  affiliate = false,
  variant = "secondary",
  size = "md",
  affiliateLabel = true,
  className = "",
}: BuyButtonProps) {
  const name = marketplaceName(marketplace);
  const mStyle = marketplaceStyle(marketplace);
  const unavailable = disabled ? "Tạm hết hàng" : !hasLink || !offerId ? "Chưa có đường dẫn mua" : null;

  if (unavailable) {
    return (
      <div className={`flex flex-col items-stretch gap-1 ${className}`}>
        <button
          type="button"
          disabled
          className={`${BASE} ${SIZE[size]} cursor-not-allowed border border-line bg-surface-2 text-ink-3`}
        >
          {unavailable}
        </button>
        {unavailable !== "Tạm hết hàng" && (
          <span className="text-center text-micro text-ink-3">DealScore chưa có liên kết tới trang bán trên {name}.</span>
        )}
      </div>
    );
  }

  const tone = variant === "primary" ? mStyle.primaryBtn : mStyle.secondaryBtn;

  return (
    <div className={`flex flex-col items-stretch gap-1 ${className}`}>
      <a
        href={`/go/${encodeURIComponent(marketplace)}/${encodeURIComponent(offerId)}?src=web`}
        target="_blank"
        rel="nofollow sponsored noopener"
        className={`${BASE} ${SIZE[size]} ${tone}`}
      >
        Đến {name}
        <ExternalIcon className="size-[18px]" strokeWidth={2} />
        <span className="sr-only">(mở trong thẻ mới{affiliate ? ", liên kết tiếp thị" : ""})</span>
      </a>
      {affiliate && affiliateLabel && (
        <span className="inline-flex items-center justify-center gap-1 text-center text-micro font-semibold text-ink-3" aria-hidden="true">
          <LinkIcon className="size-3.5" />
          Liên kết tiếp thị
        </span>
      )}
    </div>
  );
}
