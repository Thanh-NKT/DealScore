/**
 * Formatting helpers for currency, discount percentages and dates.
 */

/**
 * Format VND currency ("1.234.000 ₫").
 * Rounds to an integer. Returns "—" for null or undefined.
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
 * % off the list price, ROUNDED DOWN (Math.floor).
 * Returns null when: a price is missing, listed <= current, or the result is <= 0.
 * Never returns 0 — showing "−0%" is meaningless.
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
 * Convert a Date or timestamp string to 'YYYY-MM-DD' in Vietnam time (Asia/Ho_Chi_Minh).
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
 * Number of days between two instants, always positive.
 */
export function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.abs(da.getTime() - db.getTime()) / 86_400_000;
}
