/**
 * Savings report on "Đã mua" (roadmap P2 item B). Pure: describes a past purchase against the snapshot the
 * DB took when the watch moved to 'done' (watches_capture_purchase, migration 0040). Never a promise.
 * Tune with real data: how many median days make the comparison meaningful.
 */

/** A comparison needs at least this many days with a price in the 30-day window. */
export const SAVINGS_MIN_MEDIAN_DAYS = 14;
/** |difference| below this is "ngang trung vị". */
export const SAVINGS_MIN_VND = 1000;
/** Window of the captured median — mirrored in watches_capture_purchase (today excluded). */
export const SAVINGS_MEDIAN_WINDOW_DAYS = 30;

export interface PurchaseSnapshot {
  purchasedAt: string | null;
  purchasedPrice: number | null;
  median30d: number | null;
  medianDays: number | null;
  baselinePrice: number | null;
}

export interface SavingsLine {
  status: "saved" | "flat" | "above" | "unknown";
  /** median − purchase price: positive = bought below the 30-day median. */
  vsMedian: number | null;
  /** baseline (price when tracking started) − purchase price. */
  vsBaseline: number | null;
}

export function savingsFor(p: PurchaseSnapshot): SavingsLine {
  const price = p.purchasedPrice;
  const vsBaseline = price != null && p.baselinePrice != null && p.baselinePrice > 0 ? p.baselinePrice - price : null;
  if (price == null || !(price > 0) || p.median30d == null || (p.medianDays ?? 0) < SAVINGS_MIN_MEDIAN_DAYS) {
    return { status: "unknown", vsMedian: null, vsBaseline };
  }
  const vsMedian = p.median30d - price;
  const status = Math.abs(vsMedian) < SAVINGS_MIN_VND ? "flat" : vsMedian > 0 ? "saved" : "above";
  return { status, vsMedian, vsBaseline };
}

/** Honest net: signed sum over every comparable line (saved, flat and above). */
export function summarizeSavings(lines: SavingsLine[]): { counted: number; total: number } {
  let counted = 0;
  let total = 0;
  for (const l of lines) {
    if (l.status === "unknown" || l.vsMedian == null) continue;
    counted++;
    total += l.vsMedian;
  }
  return { counted, total };
}
