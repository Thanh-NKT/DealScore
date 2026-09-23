import type { DailyPriceRow } from "@/lib/pricing/price-history";

export interface ChartPoint {
  day: string; // 'YYYY-MM-DD'
  price: number;
}

export interface FlashMarker {
  day: string;
  price: number;
}

export interface ChartSeries {
  /** Continuous segments. A day without data BREAKS the segment — no interpolation. */
  segments: ChartPoint[][];
  flashMarkers: FlashMarker[];
  min: number | null;
  max: number | null;
  /** false with fewer than 2 points — not enough to draw. */
  renderable: boolean;
}

function parseDay(d: string): number {
  return new Date(`${d}T00:00:00Z`).getTime();
}

const ONE_DAY_MS = 86_400_000;

export function buildChartSeries(
  rows: DailyPriceRow[],
  rangeDays: 7 | 30 | 90,
  now = new Date(),
): ChartSeries {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - rangeDays * ONE_DAY_MS;

  // Keep rows inside the rangeDays window and sort by day ascending
  const inWindow = rows
    .filter((r) => {
      const rTime = parseDay(r.day);
      return rTime >= windowStartMs - ONE_DAY_MS && rTime <= nowMs + ONE_DAY_MS;
    })
    .sort((a, b) => parseDay(a.day) - parseDay(b.day));

  const segments: ChartPoint[][] = [];
  let currentSegment: ChartPoint[] = [];

  const flashMarkers: FlashMarker[] = [];
  let minVal: number | null = null;
  let maxVal: number | null = null;
  let totalPoints = 0;

  for (let i = 0; i < inWindow.length; i++) {
    const row = inWindow[i];

    // Collect flash sale markers
    if (row.has_flash_sale && row.flash_min_price != null && Number.isFinite(row.flash_min_price)) {
      flashMarkers.push({ day: row.day, price: row.flash_min_price });
      if (minVal == null || row.flash_min_price < minVal) minVal = row.flash_min_price;
      if (maxVal == null || row.flash_min_price > maxVal) maxVal = row.flash_min_price;
    }

    if (row.min_price != null && Number.isFinite(row.min_price) && row.min_price > 0) {
      const point: ChartPoint = { day: row.day, price: row.min_price };
      totalPoints++;

      if (minVal == null || row.min_price < minVal) minVal = row.min_price;
      if (maxVal == null || row.min_price > maxVal) maxVal = row.min_price;

      if (currentSegment.length === 0) {
        currentSegment.push(point);
      } else {
        const prevDay = currentSegment[currentSegment.length - 1].day;
        const diffDays = Math.round((parseDay(point.day) - parseDay(prevDay)) / ONE_DAY_MS);

        if (diffDays === 1) {
          // Consecutive day -> same segment
          currentSegment.push(point);
        } else {
          // Break the segment (gap day in between)
          segments.push(currentSegment);
          currentSegment = [point];
        }
      }
    } else {
      // Day without min_price -> break the current segment, if any
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  return {
    segments,
    flashMarkers,
    min: minVal,
    max: maxVal,
    renderable: totalPoints >= 2,
  };
}
