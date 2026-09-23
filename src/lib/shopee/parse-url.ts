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

/** Link rút gọn — phải theo redirect mới biết shopId/itemId. */
export const SHORT_HOSTS: ReadonlySet<string> = new Set(["shope.ee", "s.shopee.vn"]);
/** Host của trang sản phẩm canonical. */
export const SHOPEE_HOSTS: ReadonlySet<string> = new Set(["shopee.vn", "www.shopee.vn"]);

export function extractFirstUrl(text: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s]+/i);
  // Văn bản chia sẻ hay kẹp link trong ngoặc hoặc kết câu ngay sau link.
  return match ? match[0].replace(/[)\]}>.,;:!?'"]+$/, "") : null;
}

/**
 * Chuẩn hóa thứ người dùng dán vào: lấy URL đầu tiên nếu là cả đoạn văn bản
 * chia sẻ, thêm https:// nếu thiếu. Parse và theo redirect phải dùng CÙNG
 * chuỗi này — `shope.ee/abc` parse được nhưng `new URL("shope.ee/abc")` ném lỗi.
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

  // Chỉ thêm protocol khi chuỗi thực sự trông như một tên miền. Nếu không,
  // mọi từ khóa tìm kiếm ("samsung") sẽ thành URL hợp lệ và người dùng nhận
  // thông báo "chỉ hỗ trợ Shopee" thay vì "hãy dán một đường dẫn".
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

  // So khớp host CHÍNH XÁC theo danh sách trắng.
  // So khớp lỏng bằng includes("shopee.") hay endsWith("shopee.vn") cho lọt
  // shopee.vn.evil.com và evil-shopee.com.attacker.net — đây là URL do người
  // dùng cung cấp mà server sẽ đi gọi và ghi vào catalog, nên phải chặt.
  if (SHORT_HOSTS.has(host)) {
    return { ok: false, reason: "needs_redirect" };
  }

  if (!SHOPEE_HOSTS.has(host)) {
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
