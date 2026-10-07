import type { Database } from "@/lib/database.types";
import type { Channel } from "@/lib/account/notification-settings";
import type { NextState } from "@/lib/watch/decide";
import type { HikeDecision } from "@/lib/watch/price-hike";
import type { ConditionKey, WatchConfig, WatchState } from "@/lib/watch/types";

export type WatchRow = Database["public"]["Tables"]["watches"]["Row"];

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const CONDITION_KEYS: ConditionKey[] = ["target_price", "drop_pct", "low", "deal_score", "back_in_stock"];

export function configFromRow(row: WatchRow): WatchConfig {
  return {
    targetPrice: num(row.target_price),
    dropPct: row.drop_pct,
    notifyLow: row.notify_low,
    minDealScore: row.min_deal_score,
    notifyBackInStock: row.notify_back_in_stock,
    channels: (row.channels as Channel[] | null) ?? null,
    notifyPriceHike: row.notify_price_hike === true,
  };
}

export function stateFromRow(row: WatchRow): WatchState {
  const raw = (row.cond_state ?? {}) as Record<string, unknown>;
  const condState: Partial<Record<ConditionKey, boolean>> = {};
  for (const k of CONDITION_KEYS) if (typeof raw[k] === "boolean") condState[k] = raw[k] as boolean;
  return {
    baselinePrice: num(row.baseline_price),
    condState,
    lastAlertPrice: num(row.last_alert_price),
    lastAlertedAt: row.last_alerted_at,
    lastInStock: row.last_in_stock,
    hikeActive: row.hike_active ?? null,
    lastHikeAlertedAt: row.last_hike_alerted_at ?? null,
  };
}

/** Exactly the p_state key names of record_watch_evaluation. `hike` = decideHikeAlert's next state. */
export function toRpcState(next: NextState, hike?: HikeDecision["next"]): Record<string, unknown> {
  const out: Record<string, unknown> = { cond_state: next.condState };
  if (hike?.hikeActive !== undefined) out.hike_active = hike.hikeActive;
  if (hike?.hikeAlertedAt !== undefined) out.hike_alerted_at = hike.hikeAlertedAt;
  if (next.lastInStock !== null) out.last_in_stock = next.lastInStock;
  if (next.baselinePrice !== undefined) out.baseline_price = next.baselinePrice;
  if (next.alerted) out.alerted = next.alerted;
  return out;
}
