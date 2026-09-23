import type { PriceObservation } from "@/lib/pricing/deal-score";
import { toVnDate } from "@/lib/format";

export interface DailyPriceRow {
  day: string; // 'YYYY-MM-DD'
  min_price: number | null;
  median_price: number | null;
  max_price: number | null;
  obs_count: number;
  offer_count: number;
  has_flash_sale: boolean;
  flash_min_price: number | null;
}

/**
 * Expand the daily rollup into an observation series for computeDealScore().
 *
 * Each day contributes EXACTLY ONE observation: min_price (flash sales excluded).
 * Days with min_price = null (flash sale only, or nothing collected) are SKIPPED.
 * observed_at is set to 12:00 Vietnam time (05:00:00.000Z) that day, so daysBetween
 * is not off by one around midnight.
 */
export function expandRollup(rows: DailyPriceRow[]): PriceObservation[] {
  const result: PriceObservation[] = [];

  for (const row of rows) {
    if (row.min_price != null && Number.isFinite(row.min_price) && row.min_price > 0) {
      // row.day is 'YYYY-MM-DD'. 12:00 Vietnam time = 05:00 UTC
      const observedAt = `${row.day}T05:00:00.000Z`;
      result.push({
        observed_at: observedAt,
        price: row.min_price,
        is_flash_sale: false,
        is_valid: true,
      });
    }
  }

  // Ensure ascending time order
  return result.sort(
    (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
  );
}

/**
 * Median min_price over the window [now - fromDaysAgo, now - toDaysAgo).
 * fromDaysAgo > toDaysAgo. E.g. (74, 14) = "the 60 days before the most recent 14 days".
 * dayCount = number of days that ACTUALLY have a min_price in the window.
 */
export function medianWindow(
  rows: DailyPriceRow[],
  fromDaysAgo: number,
  toDaysAgo: number,
  now = new Date(),
): { value: number | null; dayCount: number } {
  const msPerDay = 86_400_000;

  // The window must be defined in CALENDAR DAYS, not millisecond differences.
  // Comparing milliseconds against each row's 05:00Z mark lets today's row into
  // the window in the afternoon but excludes it in the morning — the same
  // page would show two different numbers depending on when the user opens it.
  const fromDay = toVnDate(new Date(now.getTime() - fromDaysAgo * msPerDay));
  const toDay = toVnDate(new Date(now.getTime() - toDaysAgo * msPerDay));

  const validPrices: number[] = [];

  for (const row of rows) {
    if (row.min_price == null || !Number.isFinite(row.min_price) || row.min_price <= 0) {
      continue;
    }

    // Range [fromDay, toDay) — toDay is EXCLUDED, so medianWindow(rows, 30, 0)
    // covers days -30..-1 and does not include today.
    if (row.day >= fromDay && row.day < toDay) {
      validPrices.push(row.min_price);
    }
  }

  if (validPrices.length === 0) {
    return { value: null, dayCount: 0 };
  }

  validPrices.sort((a, b) => a - b);
  const n = validPrices.length;
  const mid = Math.floor(n / 2);
  const val = n % 2 === 0 ? (validPrices[mid - 1] + validPrices[mid]) / 2 : validPrices[mid];

  return { value: val, dayCount: n };
}

export interface HistoryStats {
  low: number | null;
  median: number | null;
  high: number | null;
  /** Number of days with a min_price in the window. */
  dayCount: number;
}

/**
 * Low / median / high of daily min_price over the last `windowDays` days
 * (today included) — the same data computeDealScore() receives via
 * expandRollup(), so once thresholds are met these match the Deal Score stats.
 */
export function historyStats(
  rows: DailyPriceRow[],
  now = new Date(),
  windowDays = 90,
): HistoryStats {
  const fromDay = toVnDate(new Date(now.getTime() - windowDays * 86_400_000));
  const today = toVnDate(now);
  const prices = rows
    .filter(
      (r) =>
        r.min_price != null &&
        Number.isFinite(r.min_price) &&
        r.min_price > 0 &&
        r.day >= fromDay &&
        r.day <= today,
    )
    .map((r) => r.min_price as number)
    .sort((a, b) => a - b);

  if (prices.length === 0) return { low: null, median: null, high: null, dayCount: 0 };

  const n = prices.length;
  const mid = Math.floor(n / 2);
  return {
    low: prices[0],
    median: n % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid],
    high: prices[n - 1],
    dayCount: n,
  };
}
