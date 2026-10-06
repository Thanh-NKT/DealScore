import type { DailyPriceRow } from "@/lib/pricing/price-history";
import { toVnDate } from "@/lib/format";

export interface ChartPoint {
  day: string; // 'YYYY-MM-DD' (Vietnam calendar day)
  price: number;
  /** Calendar days since `fromDay` (0 … spanDays): plot x by this, never by array index. */
  x: number;
  /** true only for today's point added from the live current price (no rollup row for today yet). */
  current?: boolean;
}

export interface FlashMarker {
  day: string;
  price: number;
  x: number;
}

export interface ChartSeries {
  /** Continuous segments. A day without data BREAKS the segment — no interpolation. */
  segments: ChartPoint[][];
  /** Every plotted point (the segments flattened), oldest first. */
  points: ChartPoint[];
  flashMarkers: FlashMarker[];
  min: number | null;
  max: number | null;
  /** false with fewer than 2 points — not enough to draw a line. */
  renderable: boolean;
  /** First calendar day of the window (today − rangeDays), Vietnam time. */
  fromDay: string;
  /** Today, Vietnam time. */
  today: string;
  /** today − fromDay in days (= rangeDays): the x axis runs 0 … spanDays. */
  spanDays: number;
}

const ONE_DAY_MS = 86_400_000;

/** Day number of a 'YYYY-MM-DD' calendar day. The string is already a Vietnam day: pure calendar arithmetic. */
function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / ONE_DAY_MS);
}

function dayString(n: number): string {
  return new Date(n * ONE_DAY_MS).toISOString().slice(0, 10);
}

const validPrice = (p: number | null | undefined): p is number => p != null && Number.isFinite(p) && p > 0;

/**
 * Chart series for the last `rangeDays` calendar days in Vietnam time: days today − rangeDays … today,
 * the same window historyStats() uses, so the chart's numbers match the Deal Score's.
 *
 * `currentPrice` (optional) is drawn as today's point when the rollup has no row for today yet; a
 * flash-sale current price becomes a flash marker instead (the line is the flash-free history).
 */
export function buildChartSeries(
  rows: DailyPriceRow[],
  rangeDays: 7 | 30 | 90,
  now = new Date(),
  opts: { currentPrice?: number | null; currentIsFlashSale?: boolean } = {},
): ChartSeries {
  const today = toVnDate(now);
  const todayN = dayNumber(today);
  const fromN = todayN - rangeDays;

  const inWindow = rows
    .filter((r) => {
      const n = dayNumber(r.day);
      return Number.isFinite(n) && n >= fromN && n <= todayN;
    })
    .sort((a, b) => a.day.localeCompare(b.day));

  const segments: ChartPoint[][] = [];
  const flashMarkers: FlashMarker[] = [];
  let current: ChartPoint[] = [];
  let lastX: number | null = null;

  const pushPoint = (point: ChartPoint) => {
    if (current.length > 0 && lastX != null && point.x - lastX !== 1) {
      segments.push(current);
      current = [];
    }
    current.push(point);
    lastX = point.x;
  };

  for (const row of inWindow) {
    const x = dayNumber(row.day) - fromN;
    if (row.has_flash_sale && validPrice(row.flash_min_price)) {
      flashMarkers.push({ day: row.day, price: row.flash_min_price, x });
    }
    if (validPrice(row.min_price)) {
      pushPoint({ day: row.day, price: row.min_price, x });
    } else if (current.length > 0) {
      // A day without a regular price breaks the line.
      segments.push(current);
      current = [];
      lastX = null;
    }
  }

  const hasToday = inWindow.some((r) => r.day === today && validPrice(r.min_price));
  if (validPrice(opts.currentPrice) && !hasToday) {
    if (opts.currentIsFlashSale) {
      if (!flashMarkers.some((f) => f.day === today)) {
        flashMarkers.push({ day: today, price: opts.currentPrice, x: rangeDays });
      }
    } else {
      pushPoint({ day: today, price: opts.currentPrice, x: rangeDays, current: true });
    }
  }
  if (current.length > 0) segments.push(current);

  const points = segments.flat();
  const all = [...points.map((p) => p.price), ...flashMarkers.map((f) => f.price)];

  return {
    segments,
    points,
    flashMarkers,
    min: all.length > 0 ? Math.min(...all) : null,
    max: all.length > 0 ? Math.max(...all) : null,
    renderable: points.length >= 2,
    fromDay: dayString(fromN),
    today,
    spanDays: rangeDays,
  };
}
