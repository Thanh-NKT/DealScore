/**
 * Display names and brand colours for marketplace codes stored in `listings.marketplace`
 * (shopee | tiktok; tiki / sendo only ever appear as names).
 *
 * DealScore's own UI is iris (a colour no marketplace owns). A marketplace's colour appears only where
 * the marketplace itself is meant: its mark / dot, and the exit button that takes the buyer there
 * ("Đến Shopee" is Shopee orange, "Đến TikTok Shop" TikTok black with its cyan/pink edge). Every
 * marketplace gets the same button shape and size: only the colour says where it goes, never how
 * prominent it is. Which button is the main one is decided by price (the best buy), not by marketplace.
 *
 * Colours are theme tokens (`--color-shopee` …, globals.css), so this file holds class names only.
 */
const MARKETPLACE_NAMES: Record<string, string> = {
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  tiktokshop: "TikTok Shop",
  tiki: "Tiki",
  sendo: "Sendo",
};

export interface MarketplaceTheme {
  /** Solid brand fill: the main exit button of a group. */
  primaryBtn: string;
  /** Brand-tinted outline: exit buttons on the other rows; fills with the brand colour on hover. */
  secondaryBtn: string;
  /** Neutral chip with a brand-coloured dot (::before), for "Shopee" / "TikTok Shop" labels. */
  badge: string;
  /** Background + text of the square marketplace mark (MarketplaceMark). */
  mark: string;
  /** One or two letters drawn in the mark. */
  initial: string;
}

type BrandKey = "shopee" | "tiktok" | "tiki" | "sendo";

// TikTok's signature: a cyan edge on one side, a pink one on the other.
const TIKTOK_EDGE = "shadow-[-2px_-1px_0_0_var(--color-tiktok-cyan),2px_1px_0_0_var(--color-tiktok-pink)]";

const BRAND: Record<BrandKey, Omit<MarketplaceTheme, "badge"> & { dot: string }> = {
  shopee: {
    primaryBtn: "bg-shopee text-on-brand hover:bg-shopee-hover shadow-[0_10px_22px_-12px_rgb(218_57_26/0.9)]",
    secondaryBtn:
      "border border-shopee/45 bg-shopee/[0.07] text-shopee-ink hover:border-shopee hover:bg-shopee hover:text-on-brand",
    mark: "bg-shopee text-on-brand",
    initial: "S",
    dot: "before:bg-shopee",
  },
  tiktok: {
    primaryBtn: `bg-tiktok text-on-brand hover:bg-tiktok-hover ${TIKTOK_EDGE} dark:ring-1 dark:ring-on-brand/20`,
    secondaryBtn:
      "border border-tiktok-ink/35 bg-tiktok-ink/[0.04] text-tiktok-ink hover:border-tiktok hover:bg-tiktok hover:text-on-brand hover:shadow-[-2px_-1px_0_0_var(--color-tiktok-cyan),2px_1px_0_0_var(--color-tiktok-pink)]",
    mark: `bg-tiktok text-on-brand shadow-[-1.5px_-1px_0_0_var(--color-tiktok-cyan),1.5px_1px_0_0_var(--color-tiktok-pink)] dark:ring-1 dark:ring-on-brand/25`,
    initial: "T",
    dot: "before:bg-tiktok before:shadow-[-1px_0_0_0_var(--color-tiktok-cyan),1px_0_0_0_var(--color-tiktok-pink)] dark:before:bg-on-brand",
  },
  tiki: {
    primaryBtn: "bg-tiki text-on-brand hover:bg-tiki-hover",
    secondaryBtn: "border border-tiki/45 bg-tiki/[0.07] text-tiki-ink hover:border-tiki hover:bg-tiki hover:text-on-brand",
    mark: "bg-tiki text-on-brand",
    initial: "Ti",
    dot: "before:bg-tiki",
  },
  sendo: {
    primaryBtn: "bg-sendo text-on-brand hover:bg-sendo-hover",
    secondaryBtn: "border border-sendo/45 bg-sendo/[0.07] text-sendo-ink hover:border-sendo hover:bg-sendo hover:text-on-brand",
    mark: "bg-sendo text-on-brand",
    initial: "Se",
    dot: "before:bg-sendo",
  },
};

// A marketplace we have no colours for: DealScore's own neutral styles.
const FALLBACK = {
  primaryBtn: "bg-primary text-on-primary hover:bg-primary-hover shadow-glow",
  secondaryBtn: "border border-line-strong/70 bg-surface text-ink hover:border-ink",
  mark: "bg-ink text-surface",
  dot: "before:bg-ink-3",
};

const BADGE_BASE =
  "inline-flex items-center gap-1.5 border border-line bg-surface text-ink-2 before:size-2 before:shrink-0 before:rounded-full before:content-['']";

function brandKey(code: string | null | undefined): string {
  const key = code?.trim().toLowerCase().replace(/[\s_-]/g, "") ?? "";
  return key === "tiktokshop" ? "tiktok" : key;
}

export function marketplaceName(code: string | null | undefined): string {
  const raw = code?.trim();
  if (!raw) return "Sàn khác";
  const known = MARKETPLACE_NAMES[raw.toLowerCase().replace(/[\s_-]/g, "")];
  if (known) return known;
  // Unknown code: show it readably rather than hiding the source.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function marketplaceStyle(code: string | null | undefined): MarketplaceTheme {
  const key = brandKey(code);
  const brand = BRAND[key as BrandKey];
  if (brand) {
    const { dot, ...rest } = brand;
    return { ...rest, badge: `${BADGE_BASE} ${dot}` };
  }
  const name = marketplaceName(code);
  return {
    primaryBtn: FALLBACK.primaryBtn,
    secondaryBtn: FALLBACK.secondaryBtn,
    mark: FALLBACK.mark,
    initial: name.charAt(0).toUpperCase(),
    badge: `${BADGE_BASE} ${FALLBACK.dot}`,
  };
}
