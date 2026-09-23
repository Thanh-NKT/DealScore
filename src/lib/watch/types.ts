import type { Channel } from "@/lib/account/notification-settings";
import type { DealScoreResult } from "@/lib/pricing/deal-score";

export type ConditionKey =
  | "target_price"
  | "drop_pct"
  | "low"
  | "deal_score"
  | "back_in_stock";

export type TriggerType = ConditionKey | "deeper_drop";

export type Tri = true | false | "unknown";

export interface WatchConfig {
  targetPrice: number | null;
  dropPct: number | null; // 1–90
  notifyLow: boolean;
  minDealScore: number | null; // 1–100
  notifyBackInStock: boolean;
  channels: Channel[] | null; // null = follow the account setting
}

export interface WatchState {
  baselinePrice: number | null;
  condState: Partial<Record<ConditionKey, boolean>>;
  lastAlertPrice: number | null;
  lastAlertedAt: string | null;
  lastInStock: boolean | null;
}

export interface VariantSnapshot {
  variantId: string;
  price: number | null;
  inStock: boolean;
  offerId: string | null;
  observedAt: string | null;
  isStale: boolean;
  deal: DealScoreResult | null;
}
