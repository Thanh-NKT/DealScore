import { DEAL_SCORE_HYSTERESIS, HYSTERESIS_RATIO } from "@/lib/watch/constants";
import type {
  ConditionKey,
  Tri,
  VariantSnapshot,
  WatchConfig,
  WatchState,
} from "@/lib/watch/types";

/** Các điều kiện Watch có bật, theo thứ tự cố định. */
export function enabledConditions(config: WatchConfig): ConditionKey[] {
  const keys: ConditionKey[] = [];
  if (config.targetPrice !== null) keys.push("target_price");
  if (config.dropPct !== null) keys.push("drop_pct");
  if (config.notifyLow) keys.push("low");
  if (config.minDealScore !== null) keys.push("deal_score");
  if (config.notifyBackInStock) keys.push("back_in_stock");
  return keys;
}

export function evaluateConditions(
  config: WatchConfig,
  state: WatchState,
  snap: VariantSnapshot,
): Partial<Record<ConditionKey, Tri>> {
  const result: Partial<Record<ConditionKey, Tri>> = {};

  // Nếu dữ liệu stale (cũ hơn 48h) → mọi điều kiện đã bật đều là "unknown"
  if (snap.isStale) {
    if (config.targetPrice !== null) result.target_price = "unknown";
    if (config.dropPct !== null) result.drop_pct = "unknown";
    if (config.notifyLow) result.low = "unknown";
    if (config.minDealScore !== null) result.deal_score = "unknown";
    if (config.notifyBackInStock) result.back_in_stock = "unknown";
    return result;
  }

  const p = snap.price;
  const ok = snap.inStock && p !== null && p > 0;
  const h = HYSTERESIS_RATIO;

  // 1. target_price
  if (config.targetPrice !== null) {
    const T = config.targetPrice;
    if (!ok || p === null) {
      result.target_price = false;
    } else if (p <= T) {
      result.target_price = true;
    } else if (state.condState.target_price === true && p <= T * (1 + h)) {
      result.target_price = true;
    } else {
      result.target_price = false;
    }
  }

  // 2. drop_pct
  if (config.dropPct !== null) {
    const B = state.baselinePrice;
    if (B === null) {
      result.drop_pct = "unknown";
    } else if (!ok || p === null) {
      result.drop_pct = false;
    } else {
      const N = B * (1 - config.dropPct / 100);
      if (p <= N) {
        result.drop_pct = true;
      } else if (state.condState.drop_pct === true && p <= N * (1 + h)) {
        result.drop_pct = true;
      } else {
        result.drop_pct = false;
      }
    }
  }

  // 3. low (đáy 90 ngày)
  if (config.notifyLow) {
    const low = snap.deal?.stats.low ?? null;
    if (low === null) {
      result.low = "unknown";
    } else if (!ok || p === null) {
      result.low = false;
    } else {
      if (p <= low) {
        result.low = true;
      } else if (state.condState.low === true && p <= low * (1 + h)) {
        result.low = true;
      } else {
        result.low = false;
      }
    }
  }

  // 4. deal_score
  if (config.minDealScore !== null) {
    const score = snap.deal?.score ?? null;
    if (score === null) {
      result.deal_score = "unknown";
    } else if (!ok) {
      result.deal_score = false;
    } else {
      const S = config.minDealScore;
      if (score >= S) {
        result.deal_score = true;
      } else if (state.condState.deal_score === true && score >= S - DEAL_SCORE_HYSTERESIS) {
        result.deal_score = true;
      } else {
        result.deal_score = false;
      }
    }
  }

  // 5. back_in_stock
  if (config.notifyBackInStock) {
    if (state.lastInStock === null) {
      result.back_in_stock = "unknown";
    } else if (state.lastInStock === false && snap.inStock) {
      result.back_in_stock = true;
    } else {
      result.back_in_stock = false;
    }
  }

  return result;
}
