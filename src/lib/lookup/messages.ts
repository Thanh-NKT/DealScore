/**
 * Error codes and messages for the URL lookup flow. Kept separate with no
 * server-side imports so Client Components can share it without pulling the admin
 * client into the browser bundle.
 */

export type LookupErrorCode =
  | "not_a_url"
  | "not_shopee"
  | "unrecognized_format"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal";

export const LOOKUP_ERROR_MESSAGE: Record<LookupErrorCode, string> = {
  not_a_url: "Hãy dán một đường dẫn sản phẩm.",
  not_shopee: "Hiện tại mới hỗ trợ Shopee.",
  unrecognized_format: "Không đọc được đường dẫn này. Hãy thử sao chép lại từ ứng dụng Shopee.",
  rate_limited: "Bạn đã tra cứu khá nhiều.",
  upstream_unavailable: "Chưa lấy được dữ liệu từ Shopee lúc này.",
  internal: "DealScore đang gặp trục trặc nên chưa kiểm tra được. Thử lại sau ít phút.",
};

export function lookupErrorMessage(code: LookupErrorCode, retryAfter?: number): string {
  if (code === "rate_limited" && retryAfter) {
    const minutes = Math.ceil(retryAfter / 60);
    return `${LOOKUP_ERROR_MESSAGE.rate_limited} Thử lại sau khoảng ${minutes} phút.`;
  }
  return LOOKUP_ERROR_MESSAGE[code];
}
