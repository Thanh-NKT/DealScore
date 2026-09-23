/**
 * Shopee URL lookup flow — the ONE shared implementation behind POST /api/lookup
 * and the /share-target page. Two entry points with two separate flows means whichever
 * lacks the rate limit becomes an unlimited ingest path.
 *
 *   normalize → parse → anti-scraping quota → follow redirect → catalog lookup
 *   → (not found) ingest quota → ingest → record outcome
 *
 * The anti-scraping quota runs BEFORE following redirects: each redirect follow costs
 * up to 3 outbound requests.
 */
import { normalizeLookupInput, parseShopeeUrl } from "@/lib/shopee/parse-url";
import { resolveShopeeRedirect } from "@/lib/shopee/resolve-redirect";
import { beginIngest, beginLookup, finishLookup } from "@/lib/rate-limit";
import { findExistingProductUrl, ingestShopeeItem } from "@/lib/ingest";
import type { LookupErrorCode } from "@/lib/lookup/messages";

export type { LookupErrorCode } from "@/lib/lookup/messages";
export { lookupErrorMessage } from "@/lib/lookup/messages";

export type LookupResult =
  | { status: "ok" | "ingested"; productUrl: string }
  | { status: "error"; code: LookupErrorCode; retryAfter?: number };

export async function lookupShopeeUrl(params: {
  raw: string;
  ipHash: string;
  userId: string | null;
}): Promise<LookupResult> {
  const input = normalizeLookupInput(params.raw);
  let parsed = parseShopeeUrl(input);

  // Syntax errors cost the system nothing — they don't count against the quota.
  if (!parsed.ok && parsed.reason !== "needs_redirect") {
    return { status: "error", code: parsed.reason };
  }

  const begun = await beginLookup({ ipHash: params.ipHash, userId: params.userId });
  if (!begun.allowed || begun.requestId == null) {
    return { status: "error", code: "rate_limited", retryAfter: begun.retryAfterSeconds };
  }
  const requestId = begun.requestId;

  try {
    if (!parsed.ok) {
      const redirect = await resolveShopeeRedirect(input);
      parsed = redirect.ok ? parseShopeeUrl(redirect.finalUrl) : parsed;
      if (!parsed.ok) {
        await finishLookup(requestId, "rejected");
        return {
          status: "error",
          code: parsed.reason === "needs_redirect" ? "unrecognized_format" : parsed.reason,
        };
      }
    }

    const ids = { shopId: parsed.shopId, itemId: parsed.itemId };

    const existing = await findExistingProductUrl(ids);
    if (existing) {
      await finishLookup(requestId, "resolved");
      return { status: "ok", productUrl: existing };
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

    const result = await ingestShopeeItem(ids);
    if (result.status === "error") {
      await finishLookup(requestId, "error");
      return { status: "error", code: result.code };
    }
    // The RPC returns 'resolved' when a concurrent request has just ingested this item.
    await finishLookup(requestId, result.status);
    return {
      status: result.status === "ingested" ? "ingested" : "ok",
      productUrl: result.productUrl,
    };
  } catch (err) {
    await finishLookup(requestId, "error");
    throw err;
  }
}
