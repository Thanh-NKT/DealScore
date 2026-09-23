import type { PriceObservation } from "@/lib/deal-score";
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
  const msPerDay = 86_400_000;

  // Cửa sổ phải được định nghĩa theo NGÀY LỊCH, không theo hiệu mili-giây.
  // Nếu so bằng mili-giây với mốc 05:00Z của từng dòng, thì dòng hôm nay lọt
  // vào cửa sổ khi chạy buổi chiều nhưng bị loại khi chạy buổi sáng — cùng một
  // trang sẽ cho hai con số khác nhau tùy giờ người dùng mở.
  const fromDay = toVnDate(new Date(now.getTime() - fromDaysAgo * msPerDay));
  const toDay = toVnDate(new Date(now.getTime() - toDaysAgo * msPerDay));

  const validPrices: number[] = [];

  for (const row of rows) {
    if (row.min_price == null || !Number.isFinite(row.min_price) || row.min_price <= 0) {
      continue;
    }

    // Khoảng [fromDay, toDay) — mốc toDay bị LOẠI TRỪ, nên medianWindow(rows, 30, 0)
    // phủ ngày -30..-1 và không gồm hôm nay.
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
  /** Số ngày có min_price trong cửa sổ. */
  dayCount: number;
}

/**
 * Đáy / trung vị / đỉnh của min_price theo ngày trong `windowDays` ngày gần
 * nhất (tính cả hôm nay) — cùng dữ liệu computeDealScore() nhận qua
 * expandRollup(), nên khi đã đủ ngưỡng các số này trùng với stats của Deal Score.
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
