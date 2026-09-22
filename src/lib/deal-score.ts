/**
 * Deal Score v0 + Buy/Wait/Avoid + Fake Sale Detector.
 * Bám sát spec ở mục C của product backlog v2.
 *
 * Thuần hàm, không phụ thuộc DB — dễ unit test và backtest.
 */

export interface PriceObservation {
  observed_at: string; // ISO
  price: number;
  is_flash_sale?: boolean;
  is_valid?: boolean;
}

/** Ngưỡng dữ liệu tối thiểu (mục B2). */
export const MIN_DAYS_FOR_SCORE = 14;
export const MIN_OBSERVATIONS_FOR_SCORE = 10;

export type Recommendation =
  | "insufficient_data" // ⚪ Chưa đủ dữ liệu
  | "buy" // 🟢 Nên mua
  | "wait" // 🟡 Có thể chờ
  | "avoid"; // 🔴 Chưa nên mua

export interface DealScoreResult {
  score: number | null; // 0–100, null nếu không đủ dữ liệu
  recommendation: Recommendation;
  reasons: string[]; // 2–4 lý do sinh tự động
  stats: {
    observations: number;
    daysCovered: number;
    low: number | null;
    median: number | null;
    high: number | null;
    percentileRank: number | null; // 0–1
  };
}

export interface DealScoreInput {
  /** Giá hiện tại của offer (variant cụ thể, đã làm sạch, còn hàng). */
  price: number;
  /** Lịch sử quan sát của sản phẩm chuẩn hóa + variant (gom mọi offer tương đương). */
  history: PriceObservation[];
  /** Giá thấp nhất hiện tại giữa các offer hợp lệ của cùng variant. */
  bestOffer?: number;
  /** Cửa sổ tính toán, mặc định 90 ngày. */
  windowDays?: number;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Tỷ lệ giá trị trong mảng ≤ p (percentile rank), 0–1. */
function percentileRank(sortedAsc: number[], p: number): number {
  let count = 0;
  for (const v of sortedAsc) {
    if (v <= p) count++;
    else break;
  }
  return count / sortedAsc.length;
}

/**
 * Tính Deal Score v0.
 *
 * Chỉ dùng các quan sát hợp lệ (is_valid !== false) và KHÔNG phải flash sale
 * để tính low/median chuẩn (mục B4). Flash sale được lưu nhưng loại ở đây.
 */
export function computeDealScore(input: DealScoreInput): DealScoreResult {
  const { price, history, bestOffer } = input;
  const windowDays = input.windowDays ?? 90;
  const now = new Date();

  const valid = history.filter(
    (o) =>
      o.is_valid !== false &&
      !o.is_flash_sale &&
      Number.isFinite(o.price) &&
      o.price > 0 &&
      daysBetween(now, new Date(o.observed_at)) <= windowDays,
  );

  const daysCovered =
    valid.length > 0
      ? daysBetween(
          new Date(
            Math.min(...valid.map((o) => new Date(o.observed_at).getTime())),
          ),
          now,
        )
      : 0;

  const emptyStats = {
    observations: valid.length,
    daysCovered: Math.round(daysCovered),
    low: null,
    median: null,
    high: null,
    percentileRank: null,
  };

  // Ngưỡng dữ liệu tối thiểu (B2).
  if (
    valid.length < MIN_OBSERVATIONS_FOR_SCORE ||
    daysCovered < MIN_DAYS_FOR_SCORE
  ) {
    return {
      score: null,
      recommendation: "insufficient_data",
      reasons: [
        `⚠ Hệ thống mới theo dõi sản phẩm này ${Math.round(daysCovered)} ngày`,
      ],
      stats: emptyStats,
    };
  }

  const prices = valid.map((o) => o.price).sort((a, b) => a - b);
  const low = prices[0];
  const high = prices[prices.length - 1];
  const med = median(prices);
  const pr = percentileRank(prices, price);

  // --- Thành phần 1: Percentile giá (50%) ---
  const cPercentile = 100 * (1 - pr);

  // --- Thành phần 2: Khoảng cách tới đáy (30%) ---
  const cToLow =
    price <= low
      ? 100
      : med > low
        ? 100 * clamp(1 - (price - low) / (med - low), 0, 1)
        : 0;

  // --- Thành phần 3: So sánh giữa các offer (20%) ---
  // Nếu không có bestOffer thì bỏ qua và chuẩn hóa lại trọng số 50/30.
  let score: number;
  const reasons: string[] = [];

  if (bestOffer && bestOffer > 0) {
    const cBetween =
      100 * clamp(1 - (price - bestOffer) / bestOffer / 0.1, 0, 1);
    score = Math.round(0.5 * cPercentile + 0.3 * cToLow + 0.2 * cBetween);
  } else {
    // Chuẩn hóa 50/30 → 62.5/37.5 khi thiếu dữ liệu multi-offer.
    score = Math.round(0.625 * cPercentile + 0.375 * cToLow);
  }
  score = clamp(score, 0, 100);

  // --- Lý do sinh tự động (mục C3) ---
  const diffFromMedian = Math.round(((med - price) / med) * 100);
  if (diffFromMedian > 0) {
    reasons.push(`✓ Thấp hơn ${diffFromMedian}% so với giá trung vị 90 ngày`);
  } else if (diffFromMedian < 0) {
    reasons.push(
      `⚠ Cao hơn ${Math.abs(diffFromMedian)}% so với giá trung vị 90 ngày`,
    );
  }

  const diffFromLow = Math.round(((price - low) / low) * 100);
  if (price <= low) {
    reasons.push("✓ Đang ở mức đáy ghi nhận");
  } else if (diffFromLow <= 5) {
    reasons.push(`✓ Chỉ cao hơn ${diffFromLow}% so với đáy ghi nhận`);
  }

  if (bestOffer && bestOffer > 0 && price <= bestOffer) {
    reasons.push("✓ Đang là offer rẻ nhất cho mẫu này");
  }

  if (daysCovered < 30) {
    reasons.push(
      `⚠ Hệ thống mới theo dõi sản phẩm này ${Math.round(daysCovered)} ngày`,
    );
  }

  // --- Buy / Wait / Avoid (mục C4) ---
  const recommendation = classify(score, price, med);

  return {
    score,
    recommendation,
    reasons: reasons.slice(0, 4),
    stats: {
      observations: valid.length,
      daysCovered: Math.round(daysCovered),
      low,
      median: med,
      high,
      percentileRank: pr,
    },
  };
}

function classify(
  score: number,
  price: number,
  median30: number,
): Recommendation {
  if (score >= 75 && price <= median30) return "buy";
  if (score < 50 || price > median30 * 1.05) return "avoid";
  if (score >= 50 && score <= 74) return "wait";
  // Rơi vào khoảng còn lại (score 75+ nhưng price > median) → chờ.
  return "wait";
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  insufficient_data: "⚪ Chưa đủ dữ liệu",
  buy: "🟢 Nên mua",
  wait: "🟡 Có thể chờ",
  avoid: "🔴 Chưa nên mua",
};

/**
 * Fake Sale Detector v0 (mục C6).
 * @returns thông điệp cảnh báo, hoặc null nếu không có dấu hiệu.
 */
export function detectFakeSale(params: {
  currentPrice: number;
  listedPrice: number; // giá niêm yết (original_price)
  median30d: number;
  median14dBeforeSale?: number;
  median60dBefore?: number;
}): string | null {
  const { currentPrice, listedPrice, median30d } = params;

  // Mức giảm niêm yết ≥ 20% nhưng giá vẫn ≥ median_30d × 0.95.
  if (listedPrice > 0) {
    const discount = 1 - currentPrice / listedPrice;
    if (discount >= 0.2 && currentPrice >= median30d * 0.95) {
      return "Mức giảm so với giá niêm yết chưa phản ánh giá thực tế thường ghi nhận.";
    }
  }

  // Tăng giá trước sale.
  if (
    params.median14dBeforeSale &&
    params.median60dBefore &&
    params.median14dBeforeSale > params.median60dBefore * 1.15
  ) {
    return "Giá tăng gần đây trước đợt giảm.";
  }

  return null;
}
