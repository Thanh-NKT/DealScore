import { parseShopeeUrl } from "@/lib/shopee/parse-url";

export type ClickSource = "web" | "extension" | "email" | "push";
const SOURCES: ReadonlySet<string> = new Set(["web", "extension", "email", "push"]);

/** G1 — Shopee Affiliate long-link format. */
const AN_REDIR_BASE = "https://s.shopee.vn/an_redir";
/** G2 — sub id separator. */
const SUB_ID_SEPARATOR = "-";

/** UUID → 32 lowercase hex, dashes removed (G2: "-" is the sub id separator). */
export function encodeClickId(clickId: string): string {
  return clickId.replace(/-/g, "").toLowerCase();
}

export function decodeClickId(hex: string): string | null {
  const h = hex.toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return null;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "{clickHex}-{source}"; null clickId (click write failed) → just "{source}". */
export function encodeSubId(clickId: string | null, source: ClickSource): string {
  return clickId ? `${encodeClickId(clickId)}${SUB_ID_SEPARATOR}${source}` : source;
}

/** Accepts an "a-b" string or an already-split array (Sub_id1..5). Never throws. */
export function parseSubId(raw: string | string[] | null | undefined): {
  clickId: string | null;
  source: ClickSource | "unknown";
} {
  const parts = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .flatMap((p) => (typeof p === "string" ? p.split(SUB_ID_SEPARATOR) : []))
    .map((p) => p.trim())
    .filter(Boolean);

  let clickId: string | null = null;
  let source: ClickSource | "unknown" = "unknown";
  for (const p of parts) {
    if (!clickId) clickId = decodeClickId(p);
    if (source === "unknown" && SOURCES.has(p.toLowerCase())) source = p.toLowerCase() as ClickSource;
  }
  return { clickId, source };
}

export function buildAffiliateUrl(input: {
  mode: "an_redir" | "short_link";
  originUrl: string;
  affiliateId: string | null;
  subId: string;
  shortLink: string | null;
  eligible: boolean;
}): { url: string; kind: "affiliate" | "origin" } {
  // Data comes from the DB — a bad value is a data bug, not a user error.
  if (!parseShopeeUrl(input.originUrl).ok) {
    throw new Error(`originUrl is not a Shopee product URL: ${input.originUrl}`);
  }
  const origin = { url: input.originUrl, kind: "origin" as const };
  if (!input.eligible) return origin;

  if (input.mode === "short_link") {
    return input.shortLink ? { url: input.shortLink, kind: "affiliate" } : origin;
  }
  if (!input.affiliateId) return origin;

  const url =
    `${AN_REDIR_BASE}?origin_link=${encodeURIComponent(input.originUrl)}` +
    `&affiliate_id=${encodeURIComponent(input.affiliateId)}&sub_id=${encodeURIComponent(input.subId)}`;
  return { url, kind: "affiliate" };
}
