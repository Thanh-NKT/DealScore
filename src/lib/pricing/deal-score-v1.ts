/**
 * Deal Score v1 (Phase 2): the v0 score, plus at most ±MAX_TOTAL_ADJUSTMENT points from trend,
 * volatility, stock and seller quality. Every adjustment carries its own reason. Pure — backtested
 * side by side with v0 (src/lib/pricing/backtest-job.ts).
 */
import {
  classify,
  computeDealScore,
  type DealScoreInput,
  type DealScoreResult,
} from "@/lib/pricing/deal-score";

export const MAX_TOTAL_ADJUSTMENT = 15;

export interface DealScoreV1Input extends DealScoreInput {
  /** Stock of the offer being scored. */
  stock?: number | null;
  seller?: { rating: number | null; isOfficial: boolean } | null;
}

export interface DealAdjustment {
  kind: "trend" | "volatility" | "stock" | "seller";
  delta: number;
  reason: string;
}

export interface DealScoreV1Result extends DealScoreResult {
  version: "v1";
  /** v0 score before adjustments. */
  base: number | null;
  adjustments: DealAdjustment[];
}

const MS_PER_DAY = 86_400_000;
const VN_OFFSET_MS = 7 * 3_600_000;
const vnDayIndex = (d: Date) => Math.floor((d.getTime() + VN_OFFSET_MS) / MS_PER_DAY);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

/** Same observation filter as computeDealScore(): valid, not flash sale, positive, inside the window. */
function windowPrices(input: DealScoreInput, today: number): Array<{ day: number; price: number }> {
  const windowDays = input.windowDays ?? 90;
  return input.history
    .map((o) => ({ o, day: vnDayIndex(new Date(o.observed_at)) }))
    .filter(
      ({ o, day }) =>
        o.is_valid !== false &&
        !o.is_flash_sale &&
        Number.isFinite(o.price) &&
        o.price > 0 &&
        day >= today - windowDays &&
        day <= today,
    )
    .map(({ o, day }) => ({ day, price: o.price }));
}

function trendAdjustment(obs: Array<{ day: number; price: number }>, today: number, price: number): DealAdjustment | null {
  const last7 = obs.filter((o) => o.day > today - 7).map((o) => o.price);
  const last30 = obs.filter((o) => o.day > today - 30).map((o) => o.price);
  if (last7.length < 3 || last30.length < 10) return null;
  const m7 = median(last7);
  const m30 = median(last30);
  const slope = (m7 - m30) / m30;
  const pct = Math.round(Math.abs(slope) * 100);
  if (slope <= -0.05) {
    return {
      kind: "trend",
      delta: -Math.min(8, pct),
      reason: `⚠ Giá đang đi xuống (−${pct}% so với trung vị 30 ngày), có thể giảm thêm`,
    };
  }
  if (slope >= 0.05 && price <= m30) {
    return {
      kind: "trend",
      delta: Math.min(5, pct),
      reason: "✓ Giá chung đang tăng trở lại, mức này có thể không kéo dài",
    };
  }
  return null;
}

function volatilityAdjustment(prices: number[], price: number, low: number, med: number): DealAdjustment | null {
  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const sd = Math.sqrt(prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length);
  const cv = sd / mean;
  if (cv >= 0.15 && price > low * 1.02) {
    return { kind: "volatility", delta: -5, reason: `⚠ Giá dao động mạnh (±${Math.round(cv * 100)}%), thường có đợt sâu hơn` };
  }
  if (cv <= 0.03 && price <= med) {
    return { kind: "volatility", delta: 3, reason: "✓ Giá ổn định, ít khi giảm sâu hơn" };
  }
  return null;
}

function stockAdjustment(stock: number | null | undefined, base: number): DealAdjustment | null {
  if (stock == null || stock <= 0 || stock > 5) return null;
  // Urgency only helps a price that is already good; it never makes a bad price look good.
  return { kind: "stock", delta: base >= 60 ? 3 : 0, reason: `⚠ Chỉ còn ${stock} sản phẩm` };
}

function sellerAdjustment(seller: DealScoreV1Input["seller"]): DealAdjustment | null {
  if (!seller) return null;
  if (seller.rating != null && seller.rating < 4.5) {
    return { kind: "seller", delta: -5, reason: `⚠ Người bán được đánh giá thấp (${seller.rating.toFixed(1)}/5)` };
  }
  if (seller.isOfficial || (seller.rating != null && seller.rating >= 4.8)) {
    return { kind: "seller", delta: 2, reason: "✓ Shop Mall / người bán uy tín" };
  }
  return null;
}

export function computeDealScoreV1(input: DealScoreV1Input): DealScoreV1Result {
  const v0 = computeDealScore(input);
  if (v0.score == null || v0.stats.low == null || v0.stats.median == null) {
    return { ...v0, version: "v1", base: v0.score, adjustments: [] };
  }

  const today = vnDayIndex(input.now ?? new Date());
  const obs = windowPrices(input, today);
  const adjustments = [
    trendAdjustment(obs, today, input.price),
    volatilityAdjustment(obs.map((o) => o.price), input.price, v0.stats.low, v0.stats.median),
    stockAdjustment(input.stock, v0.score),
    sellerAdjustment(input.seller),
  ].filter((a): a is DealAdjustment => a != null);

  const total = adjustments.reduce((s, a) => s + a.delta, 0);
  const applied = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, total));
  const score = Math.max(0, Math.min(100, v0.score + applied));

  // Reasons: v0's first three, the strongest adjustment second, the rest after; at most 4.
  const byStrength = [...adjustments].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).map((a) => a.reason);
  const head = v0.reasons.slice(0, 3);
  const reasons = [...head.slice(0, 1), ...byStrength.slice(0, 1), ...head.slice(1), ...byStrength.slice(1)];

  return {
    ...v0,
    score,
    recommendation: classify(score, input.price, v0.stats.median),
    reasons: [...new Set(reasons)].slice(0, 4),
    version: "v1",
    base: v0.score,
    adjustments,
  };
}
