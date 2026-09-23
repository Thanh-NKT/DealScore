/**
 * Luồng tra cứu URL Shopee — MỘT chỗ duy nhất, dùng chung cho POST /api/lookup
 * và trang /share-target. Hai cửa vào mà hai luồng riêng thì cửa nào thiếu
 * rate limit sẽ thành đường ingest không giới hạn.
 *
 *   chuẩn hóa → parse → hạn mức chống quét → theo redirect → tra catalog
 *   → (chưa có) hạn mức ingest → ingest → ghi outcome
 *
 * Hạn mức chống quét chạy TRƯỚC khi theo redirect: mỗi lần theo redirect là
 * tới 3 request ra ngoài.
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

  // Lỗi cú pháp không tốn gì của hệ thống — không tính vào hạn mức.
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
      // Chạm trần toàn hệ thống: người dùng không làm gì sai.
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
    // RPC trả 'resolved' khi một request đồng thời vừa ingest xong item này.
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
