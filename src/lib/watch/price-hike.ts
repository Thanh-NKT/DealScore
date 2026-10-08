import { FAKE_SALE_HIKE_RATIO } from "@/lib/pricing/deal-score";
import { medianWindow, type DailyPriceRow } from "@/lib/pricing/price-history";
import {
  PRICE_HIKE_COOLDOWN_HOURS,
  PRICE_HIKE_MIN_PRIOR_DAYS,
  PRICE_HIKE_MIN_RECENT_DAYS,
  PRICE_HIKE_REARM_RATIO,
} from "@/lib/watch/constants";
import type { AlertDecision } from "@/lib/watch/decide";
import type { VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

/**
 * Regular price of the last 14 days vs the 60 days before them — the windows of fake-sale heuristic #2.
 * Rollup `min_price` already excludes flash-sale prices.
 */
export interface PriceHikeSignal {
  recentMedian: number;
  priorMedian: number;
  /** recentMedian / priorMedian */
  ratio: number;
}

/**
 * The measurement, whenever there is enough data (≥ 10 days in the last 14, ≥ 30 in the 60 before),
 * whatever the ratio. decideHikeAlert needs sub-threshold ratios for its hysteresis.
 */
export function measurePriceHike(rows: DailyPriceRow[], now: Date): PriceHikeSignal | null {
  const recent = medianWindow(rows, 14, 0, now);
  const prior = medianWindow(rows, 74, 14, now);
  if (recent.value == null || prior.value == null || prior.value <= 0) return null;
  if (recent.dayCount < PRICE_HIKE_MIN_RECENT_DAYS || prior.dayCount < PRICE_HIKE_MIN_PRIOR_DAYS) return null;
  return { recentMedian: recent.value, priorMedian: prior.value, ratio: recent.value / prior.value };
}

/** Is `signal` (with the current price) above `ratio` on both the 14-day median and the price itself? */
function elevated(signal: PriceHikeSignal, price: number, ratio: number): boolean {
  return signal.ratio >= ratio && price >= signal.priorMedian * ratio;
}

/**
 * A pushed-up regular price: recent median ≥ prior × FAKE_SALE_HIKE_RATIO AND the current price still
 * that high. null otherwise (or without enough data).
 */
export function detectPriceHike(rows: DailyPriceRow[], price: number | null, now: Date): PriceHikeSignal | null {
  if (price == null || !(price > 0)) return null;
  const s = measurePriceHike(rows, now);
  return s && elevated(s, price, FAKE_SALE_HIKE_RATIO) ? s : null;
}

export interface HikeDecision {
  fire: boolean;
  /** null = write no hike state. */
  next: { hikeActive?: boolean; hikeAlertedAt?: string } | null;
}

const NOTHING: HikeDecision = { fire: false, next: null };

/**
 * The "chưa nên mua lúc này" alert: its own edge (`hikeActive`) and its own 7-day cooldown
 * (`lastHikeAlertedAt`). It never touches the price-drop state (last_alerted_at, last_alert_price,
 * baseline_price, cond_state), and a price-drop alert (sent or held back by its cooldown) in the same run always wins.
 */
export function decideHikeAlert(
  config: WatchConfig,
  state: WatchState,
  snap: VariantSnapshot,
  now: Date,
  main: AlertDecision,
): HikeDecision {
  const price = snap.price;
  if (!config.notifyPriceHike || snap.isStale || !snap.inStock || price == null || !(price > 0)) return NOTHING;
  // The price-drop alert wins; the edge is still there next run. A drop edge held back by its own cooldown wins
  // too: "chưa nên mua" now would contradict the drop alert that follows once the cooldown ends.
  if (main.kind === "alert" || main.kind === "suppressed_cooldown") return NOTHING;
  // Contradiction: the user's own price is reached — never say "don't buy now".
  if (config.targetPrice != null && price <= config.targetPrice) {
    return state.hikeActive === false ? NOTHING : { fire: false, next: { hikeActive: false } };
  }

  const signal = snap.hike ?? null;
  const active =
    signal != null &&
    (elevated(signal, price, FAKE_SALE_HIKE_RATIO) ||
      (state.hikeActive === true && elevated(signal, price, PRICE_HIKE_REARM_RATIO)));

  if (!active) return state.hikeActive === false ? NOTHING : { fire: false, next: { hikeActive: false } };
  if (state.hikeActive === true) return NOTHING; // still active, already reported

  const inCooldown =
    state.lastHikeAlertedAt != null &&
    now.getTime() - new Date(state.lastHikeAlertedAt).getTime() < PRICE_HIKE_COOLDOWN_HOURS * 3_600_000;
  // In cooldown the edge is NOT recorded (scenario B): once it ends, the edge is still there to report.
  if (inCooldown) return NOTHING;

  return { fire: true, next: { hikeActive: true, hikeAlertedAt: now.toISOString() } };
}

/** Mirrors what record_watch_evaluation writes for the hike keys. */
export function applyHikeNext(state: WatchState, next: HikeDecision["next"]): WatchState {
  if (!next) return state;
  return {
    ...state,
    hikeActive: next.hikeActive ?? state.hikeActive ?? null,
    lastHikeAlertedAt: next.hikeAlertedAt ?? state.lastHikeAlertedAt ?? null,
  };
}
