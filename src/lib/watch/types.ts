import type { Channel } from "@/lib/account/notification-settings";
import type { DealScoreResult } from "@/lib/pricing/deal-score";
import type { PriceHikeSignal } from "@/lib/watch/price-hike";

export type ConditionKey =
  | "target_price"
  | "drop_pct"
  | "low"
  | "deal_score"
  | "back_in_stock";

/** price_hike is not a ConditionKey: enabledConditions / evaluateConditions / decideAlert never see it. */
export type TriggerType = ConditionKey | "deeper_drop" | "price_hike";

export type Tri = true | false | "unknown";

export interface WatchConfig {
  targetPrice: number | null;
  dropPct: number | null; // 1–90
  notifyLow: boolean;
  minDealScore: number | null; // 1–100
  notifyBackInStock: boolean;
  channels: Channel[] | null; // null = follow the account setting
  /** Opt-in "Giá bị đẩy lên bất thường" alert (price-hike.ts). Absent = false. */
  notifyPriceHike?: boolean;
}

export interface WatchState {
  baselinePrice: number | null;
  condState: Partial<Record<ConditionKey, boolean>>;
  lastAlertPrice: number | null;
  lastAlertedAt: string | null;
  lastInStock: boolean | null;
  /** Price-hike edge (null = unknown) and its own cooldown clock — see decideHikeAlert. */
  hikeActive?: boolean | null;
  lastHikeAlertedAt?: string | null;
}

export interface VariantSnapshot {
  variantId: string;
  price: number | null;
  inStock: boolean;
  offerId: string | null;
  observedAt: string | null;
  isStale: boolean;
  deal: DealScoreResult | null;
  /** Rollup reference price CHANGE_WINDOW_DAYS ago (referencePrice). Display only: decideAlert never reads it. */
  price7dAgo?: number | null;
  /** 14-day vs prior 60-day regular-price measurement (measurePriceHike); read only by decideHikeAlert. */
  hike?: PriceHikeSignal | null;
}
