import type { PriceObservation } from "@/lib/deal-score";

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
 * Giãn rollup ngày thành chuỗi quan sát cho computeDealScore().
 *
 * Mỗi ngày đóng góp ĐÚNG MỘT quan sát: min_price (đã loại flash sale).
 * Ngày có min_price = null (chỉ có flash sale, hoặc không thu được) bị BỎ QUA.
 * observed_at đặt tại 12:00 giờ Việt Nam (05:00:00.000Z) của ngày đó, để daysBetween không
 * lệch một ngày do biên nửa đêm.
 */
export function expandRollup(rows: DailyPriceRow[]): PriceObservation[] {
  const result: PriceObservation[] = [];

  for (const row of rows) {
    if (row.min_price != null && Number.isFinite(row.min_price) && row.min_price > 0) {
      // row.day là 'YYYY-MM-DD'. 12:00 giờ VN = 05:00 UTC
      const observedAt = `${row.day}T05:00:00.000Z`;
      result.push({
        observed_at: observedAt,
        price: row.min_price,
        is_flash_sale: false,
        is_valid: true,
      });
    }
  }

  // Đảm bảo sắp xếp theo thời gian tăng dần
  return result.sort(
    (a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime(),
  );
}

/**
 * Trung vị min_price trong cửa sổ [now - fromDaysAgo, now - toDaysAgo).
 * fromDaysAgo > toDaysAgo. Ví dụ (74, 14) = "60 ngày trước đợt 14 ngày gần nhất".
 * dayCount = số ngày THỰC SỰ có min_price trong cửa sổ.
 */
export function medianWindow(
  rows: DailyPriceRow[],
  fromDaysAgo: number,
  toDaysAgo: number,
  now = new Date(),
): { value: number | null; dayCount: number } {
  const nowTime = now.getTime();
  const msPerDay = 86_400_000;

  const validPrices: number[] = [];

  for (const row of rows) {
    if (row.min_price == null || !Number.isFinite(row.min_price) || row.min_price <= 0) {
      continue;
    }

    const rowDate = new Date(`${row.day}T05:00:00.000Z`);
    const daysAgo = (nowTime - rowDate.getTime()) / msPerDay;

    // Khoảng [fromDaysAgo, toDaysAgo)
    if (daysAgo >= toDaysAgo && daysAgo < fromDaysAgo) {
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
