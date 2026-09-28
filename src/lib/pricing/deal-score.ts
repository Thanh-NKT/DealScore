/**
 * Deal Score v0 + Buy/Wait/Avoid + Fake Sale Detector.
 * Follows section C of product backlog v2 closely.
 *
 * Pure functions, no DB dependency — easy to unit test and backtest.
 */

export interface PriceObservation {
  observed_at: string; // ISO
  price: number;
  is_flash_sale?: boolean;
  is_valid?: boolean;
}

/** Minimum data thresholds (section B2). */
export const MIN_DAYS_FOR_SCORE = 14;
export const MIN_OBSERVATIONS_FOR_SCORE = 10;

export type Recommendation =
  | "insufficient_data" // ⚪ Not enough data
  | "buy" // 🟢 Buy
  | "wait" // 🟡 Can wait
  | "avoid"; // 🔴 Don't buy yet

export interface DealScoreResult {
  score: number | null; // 0–100, null when data is insufficient
  recommendation: Recommendation;
  reasons: string[]; // 2–4 auto-generated reasons
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
  /** Current offer price (specific variant, cleaned, in stock). */
  price: number;
  /** Observation history of the normalized product + variant (all equivalent offers pooled). */
  history: PriceObservation[];
  /** Current lowest price among valid offers of the same variant. */
  bestOffer?: number;
  /** Computation window, 90 days by default. */
  windowDays?: number;
  /**
   * Scoring instant, defaults to now. Pass it to backtest at a point in the
   * past and to keep tests independent of the real clock.
   */
  now?: Date;
}

const MS_PER_DAY = 86_400_000;
/** Vietnam is fixed at UTC+7, no daylight saving. */
const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * CALENDAR-DAY ordinal in Vietnam time. Coverage and windows are counted in calendar days,
 * not millisecond differences: otherwise the same history yields ⚪ when the page is opened
 * in the morning and a score in the afternoon.
 */
function vnDayIndex(d: Date): number {
  return Math.floor((d.getTime() + VN_OFFSET_MS) / MS_PER_DAY);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Mid-rank percentile rank, 0–1: (count of prices < p + ½ count of prices = p) / n.
 *
 * Counting ties fully (≤ p) gives a flat price — very common on Shopee —
 * rank 1 and scores it like the historical high ("Don't buy yet"), while the
 * reason simultaneously says "at the recorded low".
 */
function percentileRank(sortedAsc: number[], p: number): number {
  let below = 0;
  let equal = 0;
  for (const v of sortedAsc) {
    if (v < p) below++;
    else if (v === p) equal++;
    else break;
  }
  return (below + 0.5 * equal) / sortedAsc.length;
}

/**
 * Compute Deal Score v0.
 *
 * Only valid observations (is_valid !== false) that are NOT flash sales are used
 * for the standard low/median (section B4). Flash sales are stored but excluded here.
 */
export function computeDealScore(input: DealScoreInput): DealScoreResult {
  const { price, history, bestOffer } = input;
  const windowDays = input.windowDays ?? 90;
  const today = vnDayIndex(input.now ?? new Date());

  const valid = history.filter((o) => {
    const day = vnDayIndex(new Date(o.observed_at));
    return (
      o.is_valid !== false &&
      !o.is_flash_sale &&
      Number.isFinite(o.price) &&
      o.price > 0 &&
      day >= today - windowDays &&
      day <= today
    );
  });

  // Calendar days from the first observation to today: data on days -14..0 = 14 days.
  const daysCovered =
    valid.length > 0
      ? today - Math.min(...valid.map((o) => vnDayIndex(new Date(o.observed_at))))
      : 0;

  const emptyStats = {
    observations: valid.length,
    daysCovered,
    low: null,
    median: null,
    high: null,
    percentileRank: null,
  };

  // Minimum data thresholds (B2).
  if (
    valid.length < MIN_OBSERVATIONS_FOR_SCORE ||
    daysCovered < MIN_DAYS_FOR_SCORE
  ) {
    return {
      score: null,
      recommendation: "insufficient_data",
      reasons: [
        `⚠ Hệ thống mới theo dõi sản phẩm này ${daysCovered} ngày`,
      ],
      stats: emptyStats,
    };
  }

  const prices = valid.map((o) => o.price).sort((a, b) => a - b);
  const low = prices[0];
  const high = prices[prices.length - 1];
  const med = median(prices);
  const pr = percentileRank(prices, price);

  // --- Component 1: price percentile (50%) ---
  const cPercentile = 100 * (1 - pr);

  // --- Component 2: distance to the low (30%) ---
  const cToLow =
    price <= low
      ? 100
      : med > low
        ? 100 * clamp(1 - (price - low) / (med - low), 0, 1)
        : 0;

  // --- Component 3: cross-offer comparison (20%) ---
  // Without a bestOffer, skip it and renormalize the 50/30 weights.
  let score: number;
  const reasons: string[] = [];

  if (bestOffer && bestOffer > 0) {
    const cBetween =
      100 * clamp(1 - (price - bestOffer) / bestOffer / 0.1, 0, 1);
    score = Math.round(0.5 * cPercentile + 0.3 * cToLow + 0.2 * cBetween);
  } else {
    // Renormalize 50/30 → 62.5/37.5 when multi-offer data is missing.
    score = Math.round(0.625 * cPercentile + 0.375 * cToLow);
  }
  score = clamp(score, 0, 100);

  // --- Auto-generated reasons (section C3) ---
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
  } else if (diffFromLow === 0) {
    // Above the low by < 0.5%: "cao hơn 0%" reads as a contradiction, so say it in words.
    reasons.push("✓ Gần như bằng mức đáy ghi nhận");
  } else if (diffFromLow <= 5) {
    reasons.push(`✓ Chỉ cao hơn ${diffFromLow}% so với đáy ghi nhận`);
  }

  if (bestOffer && bestOffer > 0 && price <= bestOffer) {
    reasons.push("✓ Đang là nơi bán rẻ nhất cho mẫu này");
  }

  if (daysCovered < 30) {
    reasons.push(
      `⚠ Hệ thống mới theo dõi sản phẩm này ${daysCovered} ngày`,
    );
  }

  // --- Buy / Wait / Avoid (section C4) ---
  const recommendation = classify(score, price, med);

  return {
    score,
    recommendation,
    reasons: reasons.slice(0, 4),
    stats: {
      observations: valid.length,
      daysCovered,
      low,
      median: med,
      high,
      percentileRank: pr,
    },
  };
}

export function classify(
  score: number,
  price: number,
  median30: number,
): Recommendation {
  if (score >= 75 && price <= median30) return "buy";
  if (score < 50 || price > median30 * 1.05) return "avoid";
  if (score >= 50 && score <= 74) return "wait";
  // Falls in the remaining range (score 75+ but price > median) → wait.
  return "wait";
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  insufficient_data: "⚪ Chưa đủ dữ liệu",
  buy: "🟢 Nên mua",
  wait: "🟡 Có thể chờ",
  avoid: "🔴 Chưa nên mua",
};

/**
 * Fake Sale Detector v0 (section C6).
 * @returns a warning message, or null if there is no sign of a fake sale.
 */
export function detectFakeSale(params: {
  currentPrice: number;
  listedPrice: number; // list price (original_price)
  median30d: number;
  median14dBeforeSale?: number;
  median60dBefore?: number;
}): string | null {
  const { currentPrice, listedPrice, median30d } = params;

  // List discount ≥ 20% yet the price is still ≥ median_30d × 0.95.
  if (listedPrice > 0) {
    const discount = 1 - currentPrice / listedPrice;
    if (discount >= 0.2 && currentPrice >= median30d * 0.95) {
      return "Mức giảm so với giá niêm yết chưa phản ánh giá thực tế thường ghi nhận.";
    }
  }

  // Price hike before the sale.
  if (
    params.median14dBeforeSale &&
    params.median60dBefore &&
    params.median14dBeforeSale > params.median60dBefore * 1.15
  ) {
    return "Giá tăng gần đây trước đợt giảm.";
  }

  return null;
}
