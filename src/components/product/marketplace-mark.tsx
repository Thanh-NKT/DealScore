import { marketplaceName, marketplaceStyle } from "./marketplace";

const SIZE = {
  sm: "size-5 text-nano",
  md: "size-7 text-label",
  lg: "size-10 text-title",
} as const;

const SQUARE = { sm: "rounded-xs", md: "rounded-sm", lg: "rounded-inner" } as const;

/**
 * A marketplace's mark: a square (or round) tile in its brand colour with its initial. Not the
 * marketplace's logo — just enough colour to tell Shopee from TikTok Shop at a glance. Decorative: the
 * name is always written next to it (or `label` makes the mark announce it when it stands alone).
 */
export function MarketplaceMark({
  marketplace,
  size = "md",
  round = false,
  label = false,
  className = "",
}: {
  marketplace: string | null | undefined;
  size?: keyof typeof SIZE;
  round?: boolean;
  /** true when no visible name sits next to the mark: it then announces the marketplace. */
  label?: boolean;
  className?: string;
}) {
  const { mark, initial } = marketplaceStyle(marketplace);
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ? marketplaceName(marketplace) : undefined}
      aria-hidden={label ? undefined : true}
      className={`display inline-flex shrink-0 items-center justify-center font-bold leading-none tracking-tight ${SIZE[size]} ${
        round ? "rounded-full" : SQUARE[size]
      } ${mark} ${className}`}
    >
      {initial}
    </span>
  );
}

/** "[S] Shopee": a neutral chip with the marketplace's round mark, for labels next to prices. */
export function MarketplaceChip({ marketplace, className = "" }: { marketplace: string | null | undefined; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-line bg-surface py-0.5 pl-0.5 pr-2.5 text-micro font-semibold text-ink-2 ${className}`}
    >
      <MarketplaceMark marketplace={marketplace} size="sm" round />
      <span className="truncate">{marketplaceName(marketplace)}</span>
    </span>
  );
}
