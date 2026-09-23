/**
 * Mã lỗi và thông điệp của luồng tra cứu URL. Tách riêng, không import gì
 * phía server, để Client Component dùng chung mà không kéo admin client vào
 * bundle trình duyệt.
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
  internal: "Có lỗi xảy ra. Vui lòng thử lại.",
};

export function lookupErrorMessage(code: LookupErrorCode, retryAfter?: number): string {
  if (code === "rate_limited" && retryAfter) {
    const minutes = Math.ceil(retryAfter / 60);
    return `${LOOKUP_ERROR_MESSAGE.rate_limited} Thử lại sau khoảng ${minutes} phút.`;
  }
  return LOOKUP_ERROR_MESSAGE[code];
}
