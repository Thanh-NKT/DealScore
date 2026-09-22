/**
 * Phân tích và trích xuất thông tin shopId, itemId từ URL Shopee.
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

export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

export function parseShopeeUrl(raw: string): ParsedShopeeUrl {
  if (!raw || typeof raw !== "string") {
    return { ok: false, reason: "not_a_url" };
  }

  const trimmed = raw.trim();

  let parsed: URL;
  try {
    // Nếu người dùng không gõ protocol nhưng gõ domain shopee
    const toParse = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(toParse);
  } catch {
    return { ok: false, reason: "not_a_url" };
  }

  const host = parsed.hostname.toLowerCase();

  // Kiểm tra link rút gọn
  if (
    host === "shope.ee" ||
    host === "s.shopee.vn" ||
    host.endsWith(".shope.ee") ||
    host.endsWith(".s.shopee.vn")
  ) {
    return { ok: false, reason: "needs_redirect" };
  }

  // Kiểm tra host Shopee
  if (!host.includes("shopee.")) {
    return { ok: false, reason: "not_shopee" };
  }

  const pathname = parsed.pathname;

  // Dạng 1: /product/{shopId}/{itemId}
  const productMatch = pathname.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch) {
    return {
      ok: true,
      shopId: productMatch[1],
      itemId: productMatch[2],
    };
  }

  // Dạng 2: /-i.{shopId}.{itemId}
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
