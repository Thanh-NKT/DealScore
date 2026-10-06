/**
 * Share a deal (Phase 2). Pure. The link is the canonical product URL + ?ref=share: the canonical
 * tag drops the query, so shared links never create a duplicate page for search engines.
 */
import { formatVnd } from "@/lib/format";
import type { Recommendation } from "@/lib/pricing/deal-score";

export const SHARE_REF = "share";

export interface ShareableProduct {
  slug: string;
  categorySlug: string;
  canonicalName: string;
  price: number | null;
  recommendation: Recommendation | null;
}

const VERDICT: Partial<Record<Recommendation, string>> = {
  buy: "Nên mua",
  wait: "Có thể chờ",
  avoid: "Chưa nên mua",
};

export function shareUrl(siteUrl: string, p: Pick<ShareableProduct, "slug" | "categorySlug">): string {
  return `${siteUrl}/${p.categorySlug}/${p.slug}?ref=${SHARE_REF}`;
}

export function shareText(p: ShareableProduct): string {
  const verdict = p.recommendation ? VERDICT[p.recommendation] : undefined;
  const detail = p.price != null ? ` — ${formatVnd(p.price)}${verdict ? ` (${verdict})` : ""}` : "";
  return `${p.canonicalName}${detail} trên DealScore`;
}

export function isShareVisit(ref: string | string[] | undefined): boolean {
  return (Array.isArray(ref) ? ref[0] : ref) === SHARE_REF;
}
