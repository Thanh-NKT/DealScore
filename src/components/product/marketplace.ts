/**
 * Display names and brand colours (DESIGN.md "Màu sàn"; fills darkened where needed for 4.5:1 text contrast) for marketplace codes stored in `listings.marketplace`
 * (shopee | tiktok | lazada | tiki | sendo …).
 */
const MARKETPLACE_NAMES: Record<string, string> = {
  shopee: "Shopee",
  tiktok: "TikTok Shop",
  tiktokshop: "TikTok Shop",
  lazada: "Lazada",
  tiki: "Tiki",
  sendo: "Sendo",
};

export interface MarketplaceTheme {
  primaryBtn: string;
  secondaryBtn: string;
  badge: string;
}

const MARKETPLACE_THEMES: Record<string, MarketplaceTheme> = {
  shopee: {
    primaryBtn: "bg-[#D73818] text-white hover:bg-[#B92F14] shadow-xs",
    secondaryBtn:
      "border border-[#EE4D2D]/35 bg-[#EE4D2D]/10 text-[#B3301A] hover:bg-[#D73818] hover:text-white dark:text-[#FF7A59]",
    badge: "border border-[#EE4D2D]/30 bg-[#EE4D2D]/12 text-[#B3301A] dark:text-[#FF7A59]",
  },
  lazada: {
    primaryBtn: "bg-[#0F146D] text-white hover:bg-[#1C249E] dark:bg-[#2E38E0] dark:hover:bg-[#3F49F0] shadow-xs",
    secondaryBtn:
      "border border-[#0F146D]/35 bg-[#0F146D]/10 text-[#0F146D] hover:bg-[#0F146D] hover:text-white dark:border-[#6B75FF]/40 dark:bg-[#6B75FF]/15 dark:text-[#9BA2FF] dark:hover:bg-[#3F49F0] dark:hover:text-white",
    badge:
      "border border-[#0F146D]/25 bg-[#0F146D]/10 text-[#0F146D] dark:border-[#6B75FF]/35 dark:bg-[#6B75FF]/15 dark:text-[#9BA2FF]",
  },
  tiki: {
    primaryBtn: "bg-[#0B6FD1] text-white hover:bg-[#0A5FB3] shadow-xs",
    secondaryBtn:
      "border border-[#1A94FF]/40 bg-[#1A94FF]/10 text-[#0B63B8] hover:bg-[#0B6FD1] hover:text-white dark:text-[#5CB3FF]",
    badge: "border border-[#1A94FF]/30 bg-[#1A94FF]/12 text-[#0B63B8] dark:text-[#5CB3FF]",
  },
  tiktok: {
    primaryBtn: "bg-[#161823] text-white hover:bg-[#292C3E] dark:bg-[#E0204A] dark:hover:bg-[#C81A40] shadow-xs",
    secondaryBtn:
      "border border-[#161823]/35 bg-[#161823]/8 text-[#161823] hover:bg-[#161823] hover:text-white dark:border-[#FE2C55]/40 dark:bg-[#FE2C55]/15 dark:text-[#FF6B88] dark:hover:bg-[#E0204A] dark:hover:text-white",
    badge:
      "border border-[#161823]/25 bg-[#161823]/10 text-[#161823] dark:border-[#FE2C55]/35 dark:bg-[#FE2C55]/15 dark:text-[#FF6B88]",
  },
  sendo: {
    primaryBtn: "bg-[#E5101D] text-white hover:bg-[#C40B16] shadow-xs",
    secondaryBtn:
      "border border-[#E5101D]/35 bg-[#E5101D]/10 text-[#C40B16] hover:bg-[#E5101D] hover:text-white dark:text-[#FF6B74]",
    badge: "border border-[#E5101D]/30 bg-[#E5101D]/10 text-[#C40B16] dark:text-[#FF6B74]",
  },
};

const DEFAULT_THEME: MarketplaceTheme = {
  primaryBtn: "bg-primary text-on-primary hover:bg-primary-hover shadow-xs",
  secondaryBtn: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  badge: "border border-line bg-surface-2 text-ink-2",
};

export function marketplaceName(code: string | null | undefined): string {
  const raw = code?.trim();
  if (!raw) return "Sàn khác";
  const known = MARKETPLACE_NAMES[raw.toLowerCase().replace(/[\s_-]/g, "")];
  if (known) return known;
  // Unknown code: show it readably rather than hiding the source.
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function marketplaceStyle(code: string | null | undefined): MarketplaceTheme {
  const key = code?.trim().toLowerCase().replace(/[\s_-]/g, "") ?? "";
  if (key === "tiktokshop") return MARKETPLACE_THEMES.tiktok;
  return MARKETPLACE_THEMES[key] ?? DEFAULT_THEME;
}

