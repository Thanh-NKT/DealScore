/**
 * Các hàm tiện ích định dạng tiền tệ, phần trăm giảm giá và ngày giờ.
 */

/**
 * Định dạng tiền tệ VND ("1.234.000 ₫").
 * Làm tròn về số nguyên. Trả về "—" nếu null hoặc undefined.
 */
export function formatVnd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/**
 * % giảm so với giá niêm yết, LÀM TRÒN XUỐNG (Math.floor).
 * Trả null khi: thiếu giá, listed <= current, hoặc kết quả <= 0.
 * Không bao giờ trả 0 — hiển thị "−0%" là vô nghĩa.
 */
export function discountPercent(
  current: number | null | undefined,
  listed: number | null | undefined,
): number | null {
  if (
    current == null ||
    listed == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(listed) ||
    listed <= current ||
    listed <= 0
  ) {
    return null;
  }

  const pct = Math.floor(((listed - current) / listed) * 100);
  return pct > 0 ? pct : null;
}

/**
 * Chuyển Date hoặc chuỗi timestamp sang 'YYYY-MM-DD' theo múi giờ Việt Nam (Asia/Ho_Chi_Minh).
 */
export function toVnDate(d: Date | string): string {
  const dateObj = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dateObj);
}

/**
 * Số ngày giữa hai mốc thời gian, luôn dương.
 */
export function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.abs(da.getTime() - db.getTime()) / 86_400_000;
}
