import type { DealScoreResult, Recommendation } from "@/lib/pricing/deal-score";

/**
 * Pure. Deal Score label per variant in the variant picker (roadmap P1 item 7). The selected variant shows the
 * page's live score; other variants show the variant_deal_scores cache only while it still describes the price
 * on screen — otherwise nothing (never a guess).
 */

/** A cached score older than this is not shown. Tune with real data (collector cadence: ≤ 24 h per listing). */
export const VARIANT_SCORE_MAX_AGE_HOURS = 48;
/** đ — cache price vs current price; numeric(14,2) rounding only. */
export const SCORE_PRICE_TOLERANCE = 1;

export interface CachedVariantScore {
  score: number | null;
  /** null = the cached value is not a known recommendation (see asRecommendation): nothing is shown. */
  recommendation: Recommendation | null;
  priceAtCompute: number | null;
  computedAt: string;
}

export type VariantVerdict =
  | { kind: "score"; score: number; recommendation: "buy" | "wait" | "avoid"; live: boolean }
  | { kind: "insufficient"; live: boolean }
  | { kind: "none" };

const NONE: VariantVerdict = { kind: "none" };
const RECOMMENDATIONS: readonly Recommendation[] = ["buy", "wait", "avoid", "insufficient_data"];

/** A cached recommendation from the DB, or null when it is not one of the four known values. */
export function asRecommendation(value: unknown): Recommendation | null {
  return RECOMMENDATIONS.includes(value as Recommendation) ? (value as Recommendation) : null;
}
const ringScore = (s: number) => Math.min(100, Math.max(0, Math.round(s)));

function toVerdict(score: number | null, recommendation: Recommendation, live: boolean): VariantVerdict {
  if (score == null || !Number.isFinite(score) || recommendation === "insufficient_data") return { kind: "insufficient", live };
  return { kind: "score", score: ringScore(score), recommendation, live };
}

export function variantVerdict(input: {
  variant: { id: string; price: number | null; inStock: boolean };
  selectedId: string;
  headline: DealScoreResult | null;
  cached: CachedVariantScore | null;
  now: Date;
}): VariantVerdict {
  const { variant, selectedId, headline, cached, now } = input;
  if (variant.id === selectedId) {
    return headline ? toVerdict(headline.score, headline.recommendation, true) : NONE;
  }
  if (!variant.inStock || variant.price == null || !cached || cached.priceAtCompute == null || cached.recommendation == null) return NONE;
  if (Math.abs(cached.priceAtCompute - variant.price) > SCORE_PRICE_TOLERANCE) return NONE;
  const computed = Date.parse(cached.computedAt);
  if (!Number.isFinite(computed) || now.getTime() - computed > VARIANT_SCORE_MAX_AGE_HOURS * 3_600_000) return NONE;
  return toVerdict(cached.score, cached.recommendation, false);
}
