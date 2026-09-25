/**
 * The ONE entry point for Deal Scores. Product page, search cache, alerts and the default backtest
 * all go through scoreDeal(), so switching versions is this constant — never a per-caller choice.
 * v0 stays available for the side-by-side weekly backtest.
 */
import { computeDealScore, type DealScoreResult } from "@/lib/pricing/deal-score";
import { computeDealScoreV1, type DealScoreV1Input } from "@/lib/pricing/deal-score-v1";

export type DealScoreVersion = "v0" | "v1";

export const DEAL_SCORE_VERSION: DealScoreVersion = "v1";

export function scoreDeal(input: DealScoreV1Input, version: DealScoreVersion = DEAL_SCORE_VERSION): DealScoreResult {
  return version === "v1" ? computeDealScoreV1(input) : computeDealScore(input);
}
