/**
 * Product URL lookup flow — the ONE shared implementation behind POST /api/lookup
 * and the /share-target page. Two entry points with two separate flows means whichever
 * lacks the rate limit becomes an unlimited ingest path.
 *
 *   normalize → detect marketplace (no source → not_shopee + market, free) → parse
 *   → anti-scraping quota → follow redirect → catalog lookup
 *   → (not found) ingest quota → ingest → record outcome
 *
 * The anti-scraping quota runs BEFORE following redirects: each redirect follow costs
 * up to 3 outbound requests.
 */
import { normalizeLookupInput } from "@/lib/shopee/parse-url";
import { detectMarketplace, parseProductUrl, type ParsedItem } from "@/lib/marketplaces";
import { getSource } from "@/lib/marketplaces/sources";
import { resolveProductRedirect } from "@/lib/lookup/resolve-redirect";
import { beginIngest, beginLookup, finishLookup } from "@/lib/rate-limit";
import { findExistingProductUrl, ingestProduct } from "@/lib/ingest";
import type { LookupErrorCode } from "@/lib/lookup/messages";

export type { LookupErrorCode } from "@/lib/lookup/messages";
export { lookupErrorMessage } from "@/lib/lookup/messages";

export type LookupResult =
  | { status: "ok" | "ingested"; productUrl: string }
  | { status: "error"; code: LookupErrorCode; retryAfter?: number; market?: string };

export async function lookupProductUrl(params: {
  raw: string;
  ipHash: string;
  userId: string | null;
}): Promise<LookupResult> {
  const input = normalizeLookupInput(params.raw);
  const found = detectMarketplace(input);
  if (!found) {
    let isUrl = true;
    try {
      new URL(input);
    } catch {
      isUrl = false;
    }
    return { status: "error", code: isUrl ? "not_shopee" : "not_a_url" };
  }

  // A marketplace Kairo has no data for: say which one, for free. Shopee keeps its old answer
  // (upstream_unavailable) so the copy never reads "chưa đọc được link Shopee".
  const source = getSource(found.adapter.id);
  const usable = source?.isConfigured() ?? false;
  if (!usable && found.adapter.id !== "shopee") {
    return { status: "error", code: "not_shopee", market: found.adapter.name };
  }

  let parsed = found.adapter.parseUrl(found.url);
  // Syntax errors cost the system nothing — they don't count against the quota.
  if (!parsed.ok && parsed.reason !== "needs_redirect") {
    return { status: "error", code: parsed.reason === "not_supported" ? "not_shopee" : parsed.reason };
  }

  const begun = await beginLookup({ ipHash: params.ipHash, userId: params.userId });
  if (!begun.allowed || begun.requestId == null) {
    return { status: "error", code: "rate_limited", retryAfter: begun.retryAfterSeconds };
  }
  const requestId = begun.requestId;

  try {
    if (!parsed.ok) {
      const redirect = await resolveProductRedirect(found.url.toString());
      const after = redirect.ok ? parseProductUrl(redirect.finalUrl) : null;
      if (!after || !after.ok || after.item.marketplace !== found.adapter.id) {
        await finishLookup(requestId, "rejected");
        return { status: "error", code: "unrecognized_format" };
      }
      parsed = after;
    }
    const item: ParsedItem = parsed.item;

    const existing = await findExistingProductUrl({ marketplace: item.marketplace, externalItemId: item.externalItemId });
    if (existing) {
      await finishLookup(requestId, "resolved");
      return { status: "ok", productUrl: existing };
    }

    if (!usable) {
      // Shopee without a source: same answer as before the multi-marketplace change.
      await finishLookup(requestId, "error");
      return { status: "error", code: "upstream_unavailable" };
    }

    const ingestVerdict = await beginIngest(requestId);
    if (!ingestVerdict.allowed) {
      // System-wide cap reached: the user did nothing wrong.
      return {
        status: "error",
        code: ingestVerdict.reason === "global_daily" ? "upstream_unavailable" : "rate_limited",
        retryAfter: ingestVerdict.retryAfterSeconds,
      };
    }

    const result = await ingestProduct(item.marketplace, item.externalItemId);
    if (result.status === "error") {
      await finishLookup(requestId, "error");
      return { status: "error", code: result.code };
    }
    // The RPC returns 'resolved' when a concurrent request has just ingested this item.
    await finishLookup(requestId, result.status);
    return { status: result.status === "ingested" ? "ingested" : "ok", productUrl: result.productUrl };
  } catch (err) {
    await finishLookup(requestId, "error");
    throw err;
  }
}
