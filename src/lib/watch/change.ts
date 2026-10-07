import { toVnDate } from "@/lib/format";
import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { CHANGE_REF_LOOKBACK_DAYS } from "@/lib/watch/constants";

/** Pure. "Thay đổi 7 ngày" for the watch list — never read by decideAlert / evaluateConditions. */

const MS_PER_DAY = 86_400_000;

export interface PriceChange {
  amount: number;
  pct: number;
  refPrice: number;
  days: number;
}

/**
 * min_price of the latest rollup day in [today−daysAgo−lookback, today−daysAgo] (Vietnam calendar days);
 * null if none. Days without a valid min_price (flash-sale only) are skipped. Days compare as 'YYYY-MM-DD'
 * strings, like medianWindow.
 */
export function referencePrice(
  rows: DailyPriceRow[],
  daysAgo: number,
  now: Date,
  lookbackDays = CHANGE_REF_LOOKBACK_DAYS,
): number | null {
  const toDay = toVnDate(new Date(now.getTime() - daysAgo * MS_PER_DAY));
  const fromDay = toVnDate(new Date(now.getTime() - (daysAgo + lookbackDays) * MS_PER_DAY));
  let best: DailyPriceRow | null = null;
  for (const r of rows) {
    if (r.min_price == null || !Number.isFinite(r.min_price) || r.min_price <= 0) continue;
    if (r.day < fromDay || r.day > toDay) continue;
    if (!best || r.day > best.day) best = r;
  }
  return best ? best.min_price : null;
}

/** current − ref; null when either is missing / ≤ 0. pct = amount / ref. */
export function priceChange(current: number | null, ref: number | null, days: number): PriceChange | null {
  if (current == null || ref == null || !(current > 0) || !(ref > 0)) return null;
  const amount = current - ref;
  return { amount, pct: amount / ref, refPrice: ref, days };
}
