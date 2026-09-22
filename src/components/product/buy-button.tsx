interface BuyButtonProps {
  offerId: string;
  marketplace: string;
  disabled?: boolean;
}

export function BuyButton({
  offerId,
  marketplace,
  disabled = false,
}: BuyButtonProps) {
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded-lg border border-border bg-black/5 px-3 py-1.5 text-xs font-medium text-muted opacity-50 dark:bg-white/5"
      >
        Tạm hết hàng
      </button>
    );
  }

  const marketLabel =
    marketplace.toLowerCase() === "shopee" ? "Shopee" : marketplace;

  return (
    <a
      href={`/go/${marketplace}/${offerId}?src=web`}
      target="_blank"
      rel="nofollow sponsored noopener"
      className="inline-flex items-center justify-center rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background transition-opacity hover:opacity-90 active:scale-95"
    >
      Mua trên {marketLabel} ↗
    </a>
  );
}
