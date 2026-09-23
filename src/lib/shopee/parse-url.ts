/**
 * Parse a Shopee URL and extract shopId and itemId.
 */

export type ParsedShopeeUrl =
  | { ok: true; shopId: string; itemId: string }
  | {
      ok: false;
      reason:
        | "not_a_url"
        | "not_shopee"
        | "unrecognized_format"
        | "needs_redirect";
    };

export function externalItemId(shopId: string, itemId: string): string {
  return `${shopId}_${itemId}`;
}

/** Short links — the redirect must be followed to learn shopId/itemId. */
export const SHORT_HOSTS: ReadonlySet<string> = new Set(["shope.ee", "s.shopee.vn"]);
/** Canonical product page hosts. */
export const SHOPEE_HOSTS: ReadonlySet<string> = new Set(["shopee.vn", "www.shopee.vn"]);

export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  // Shared text often wraps the link in brackets or ends the sentence right after it.
  return match ? match[0].replace(/[)\]}>.,;:!?'"]+$/, "") : null;
}

/**
 * Normalize what the user pasted: take the first URL if it's a whole block of shared
 * text, add https:// if missing. Parsing and redirect-following must use the SAME
 * string — `shope.ee/abc` parses but `new URL("shope.ee/abc")` throws.
 */
export function normalizeLookupInput(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const candidate = extractFirstUrl(trimmed) ?? trimmed;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  const looksLikeHost = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#|:)/i.test(candidate);
  return looksLikeHost ? `https://${candidate}` : candidate;
}

export function parseShopeeUrl(raw: string): ParsedShopeeUrl {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "not_a_url" };
  }

  const trimmed = raw.trim();

  // Only add a protocol when the string really looks like a domain. Otherwise
  // every search term ("samsung") becomes a valid URL and the user gets
  // "only Shopee is supported" instead of "please paste a link".
  const looksLikeHost = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#|:)/i.test(trimmed);

  let parsed: URL;
  try {
    if (!/^https?:\/\//i.test(trimmed) && !looksLikeHost) {
      return { ok: false, reason: "not_a_url" };
    }
    const toParse = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(toParse);
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  const host = parsed.hostname.toLowerCase();

  // Match hosts EXACTLY against the allowlist.
  // Loose matching via includes("shopee.") or endsWith("shopee.vn") lets through
  // shopee.vn.evil.com and evil-shopee.com.attacker.net — this is a user-supplied
  // URL the server will fetch and write into the catalog, so it must be strict.
  if (SHORT_HOSTS.has(host)) {
    return { ok: false, reason: "needs_redirect" };
  }

  if (!SHOPEE_HOSTS.has(host)) {
    return { ok: false, reason: "not_shopee" };
  }

  const pathname = parsed.pathname;

  // Form 1: /product/{shopId}/{itemId}
  const productMatch = pathname.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch) {
    return {
      ok: true,
      shopId: productMatch[1],
      itemId: productMatch[2],
    };
  }

  // Form 2: /-i.{shopId}.{itemId}
  const slugMatch = pathname.match(/-i\.(\d+)\.(\d+)/i);
  if (slugMatch) {
    return {
      ok: true,
      shopId: slugMatch[1],
      itemId: slugMatch[2],
    };
  }

  return { ok: false, reason: "unrecognized_format" };
}
