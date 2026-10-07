import { toVnDate } from "@/lib/format";
import type { DailyPriceRow } from "@/lib/pricing/price-history";

/**
 * Grounded target-price suggestion (roadmap P2 item D): how often the regular daily low actually reached a
 * typed target in the last 90 days. Describes history only — never a forecast. Rollup `min_price` already
 * excludes flash-sale prices. Tune with real data (window, minimum days, percentile).
 */
export const TARGET_EVIDENCE_WINDOW_DAYS = 90;
export const TARGET_EVIDENCE_MIN_DAYS = 14;
/** "Mức giá hay chạm": this percentile of the window's daily lows, rounded down to 10,000 ₫. */
export const TARGET_SUGGEST_PERCENTILE = 0.25;
const TARGET_SUGGEST_STEP = 10_000;

export interface TargetEvidence {
  windowDays: number;
  /** Days with a price in the window. */
  dataDays: number;
  /** Data days whose low was ≤ target. */
  hitDays: number;
  /** Maximal runs of hit days; a day without data does not break a run, a data day above target does. */
  episodes: number;
  lastHitDay: string | null;
  /** VN calendar days from lastHitDay to today (0 = today). */
  daysSinceLastHit: number | null;
  /** Lowest daily low in the window. */
  low: number;
}

/** Data days of the window (today included, like historyStats), oldest first. */
function windowRows(rows: DailyPriceRow[], now: Date): Array<{ day: string; price: number }> {
  const fromDay = toVnDate(new Date(now.getTime() - TARGET_EVIDENCE_WINDOW_DAYS * 86_400_000));
  const today = toVnDate(now);
  return rows
    .filter((r) => r.min_price != null && Number.isFinite(r.min_price) && r.min_price > 0 && r.day >= fromDay && r.day <= today)
    .map((r) => ({ day: r.day, price: r.min_price as number }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

export function targetEvidence(rows: DailyPriceRow[], target: number, now: Date): TargetEvidence | null {
  if (!Number.isFinite(target) || target <= 0) return null;
  const days = windowRows(rows, now);
  if (days.length < TARGET_EVIDENCE_MIN_DAYS) return null;

  let hitDays = 0;
  let episodes = 0;
  let inRun = false;
  let lastHitDay: string | null = null;
  let low = Infinity;
  for (const d of days) {
    low = Math.min(low, d.price);
    if (d.price <= target) {
      hitDays++;
      if (!inRun) episodes++;
      inRun = true;
      lastHitDay = d.day;
    } else {
      inRun = false;
    }
  }
  return {
    windowDays: TARGET_EVIDENCE_WINDOW_DAYS,
    dataDays: days.length,
    hitDays,
    episodes,
    lastHitDay,
    daysSinceLastHit: lastHitDay ? dayNumber(toVnDate(now)) - dayNumber(lastHitDay) : null,
    low,
  };
}

/** The "Mức giá hay chạm" preset: TARGET_SUGGEST_PERCENTILE of the window's lows, rounded down to 10,000 ₫. */
export function typicalTarget(rows: DailyPriceRow[], now: Date): number | null {
  const prices = windowRows(rows, now)
    .map((d) => d.price)
    .sort((a, b) => a - b);
  if (prices.length < TARGET_EVIDENCE_MIN_DAYS) return null;
  // Linear interpolation between the closest ranks.
  const pos = (prices.length - 1) * TARGET_SUGGEST_PERCENTILE;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const value = prices[lo] + (prices[hi] - prices[lo]) * (pos - lo);
  const rounded = Math.floor(value / TARGET_SUGGEST_STEP) * TARGET_SUGGEST_STEP;
  return rounded > 0 ? rounded : null;
}
