import { COOLDOWN_HOURS, DEEPER_DROP_RATIO } from "@/lib/watch/constants";
import { evaluateConditions } from "@/lib/watch/conditions";
import type { ConditionKey, TriggerType, VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

export interface NextState {
  condState: Partial<Record<ConditionKey, boolean>>;
  lastInStock: boolean | null;
  /** Only when it must be set (first price seen) or moved (drop_pct fired). */
  baselinePrice?: number;
  alerted?: { price: number; at: string };
}

export interface AlertDecision {
  kind: "skip_stale" | "no_alert" | "suppressed_cooldown" | "alert";
  triggerTypes: TriggerType[]; // empty unless kind = "alert"
  nextState: NextState | null; // null = write no state (skip_stale)
}

const PRICE_CONDITIONS: ConditionKey[] = ["target_price", "drop_pct", "low"];

export function decideAlert(
  config: WatchConfig,
  state: WatchState,
  snap: VariantSnapshot,
  now: Date,
): AlertDecision {
  if (snap.isStale) return { kind: "skip_stale", triggerTypes: [], nextState: null };

  const tri = evaluateConditions(config, state, snap);
  const keys = Object.keys(tri) as ConditionKey[];
  const p = snap.price;
  const ok = snap.inStock && p != null && p > 0;

  // Back in stock is an edge by itself; other conditions need the previous value to be not-true.
  const newlyTrue = keys.filter(
    (k) => tri[k] === true && (k === "back_in_stock" || state.condState[k] !== true),
  );

  const priceTrue = PRICE_CONDITIONS.some((k) => tri[k] === true);
  const deeper =
    priceTrue && state.lastAlertPrice != null && p! <= state.lastAlertPrice * (1 - DEEPER_DROP_RATIO);

  const triggers: TriggerType[] = [...newlyTrue, ...(deeper ? (["deeper_drop"] as const) : [])];

  const condState: Partial<Record<ConditionKey, boolean>> = { ...state.condState };
  for (const k of keys) {
    const v = tri[k];
    if (v === true || v === false) condState[k] = v; // "unknown" keeps the old value
  }

  const next: NextState = { condState, lastInStock: snap.inStock };
  if (state.baselinePrice == null && ok) next.baselinePrice = p!;

  if (triggers.length === 0) return { kind: "no_alert", triggerTypes: [], nextState: next };

  const inCooldown =
    state.lastAlertedAt != null &&
    now.getTime() - new Date(state.lastAlertedAt).getTime() < COOLDOWN_HOURS * 3_600_000;

  if (inCooldown) {
    // Do NOT write true for the edge just caught: if we did, once the cooldown ends there
    // is no edge left to report, and the alert is lost forever (scenario B).
    for (const k of newlyTrue) {
      if (state.condState[k] === undefined) delete condState[k];
      else condState[k] = state.condState[k];
    }
    if (newlyTrue.includes("back_in_stock")) next.lastInStock = state.lastInStock;
    return { kind: "suppressed_cooldown", triggerTypes: [], nextState: next };
  }

  next.alerted = { price: p!, at: now.toISOString() };
  if (triggers.includes("drop_pct")) next.baselinePrice = p!; // move the baseline (W3)
  return { kind: "alert", triggerTypes: triggers, nextState: next };
}

/** Mirrors exactly what record_watch_evaluation writes into watches. */
export function applyNextState(state: WatchState, next: NextState | null): WatchState {
  if (!next) return state;
  return {
    ...state, // keeps the price-hike keys, which this decision never writes
    baselinePrice: next.baselinePrice ?? state.baselinePrice,
    condState: next.condState,
    lastInStock: next.lastInStock ?? state.lastInStock,
    lastAlertPrice: next.alerted?.price ?? state.lastAlertPrice,
    lastAlertedAt: next.alerted?.at ?? state.lastAlertedAt,
  };
}
