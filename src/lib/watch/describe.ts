import {
  WEEKDAY_LABELS,
  type Channel,
  type IsoWeekday,
  type NotificationSettings,
} from "@/lib/account/notification-settings";
import type { DealScoreResult } from "@/lib/pricing/deal-score";
import { priceChange, type PriceChange } from "@/lib/watch/change";
import { evaluateConditions } from "@/lib/watch/conditions";
import { CHANGE_WINDOW_DAYS } from "@/lib/watch/constants";
import type {
  ConditionKey,
  Tri,
  VariantSnapshot,
  WatchConfig,
  WatchState,
} from "@/lib/watch/types";

export interface LatestAlert {
  id: string;
  createdAt: string;
  deliverAfter: string;
  deliveries: Array<{ channel: Channel; status: string; sentAt: string | null }>;
}

export interface WatchView {
  price: number | null;
  inStock: boolean;
  isStale: boolean;
  observedAt: string | null;
  deal: DealScoreResult | null;
  target: {
    amount: number;
    gap: number;
    gapPct: number;
    reached: boolean;
  } | null;
  changeSinceStart: {
    amount: number;
    pct: number;
    since: string;
  } | null;
  /** Current price vs the rollup price CHANGE_WINDOW_DAYS ago; null = not enough history yet. */
  change7d: PriceChange | null;
  conditions: Array<{ key: ConditionKey; state: Tri }>;
  /** "Báo khi giá bị đẩy lên" — null when the watch did not opt in. `active` only from state.hikeActive. */
  priceHike?: { active: boolean } | null;
  alertStatus:
    | { kind: "none" }
    | { kind: "sent"; at: string; channels: Channel[] }
    | {
        kind: "scheduled";
        deliverAfter: string;
        reason: ScheduledReason;
        /** Vietnamese copy, e.g. "Sẽ gửi trong bản tóm tắt Thứ Hai lúc 08:00". */
        text: string;
      };
  sortKey: number;
}

export type ScheduledReason = "quiet_hours" | "daily_digest" | "weekly_digest";

const VN_OFFSET_MS = 7 * 3_600_000;
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** User-facing line for an alert held back until `deliverAfter` (shown in Vietnam time). */
export function scheduledText(reason: ScheduledReason, deliverAfter: string): string {
  const d = new Date(deliverAfter);
  if (Number.isNaN(d.getTime())) return "Sẽ gửi sau";
  const vn = new Date(d.getTime() + VN_OFFSET_MS); // UTC fields = Vietnam wall time
  const hour = hh(vn.getUTCHours());
  if (reason === "weekly_digest") {
    const weekday = (((vn.getUTCDay() + 6) % 7) + 1) as IsoWeekday;
    return `Sẽ gửi trong bản tóm tắt ${WEEKDAY_LABELS[weekday]} lúc ${hour}`;
  }
  if (reason === "daily_digest") return `Sẽ gửi trong bản tóm tắt hằng ngày lúc ${hour}`;
  return `Sẽ gửi lúc ${hour}, khi hết giờ im lặng`;
}

export function describeWatch(input: {
  config: WatchConfig;
  state: WatchState;
  snapshot: VariantSnapshot;
  createdAt: string;
  latestAlert: LatestAlert | null;
  settings: NotificationSettings;
}): WatchView {
  const { config, state, snapshot, createdAt, latestAlert, settings } = input;
  const { price, inStock, isStale } = snapshot;

  // 1. Distance to target
  let targetInfo: WatchView["target"] = null;
  let sortKey = 1;

  if (config.targetPrice !== null) {
    const target = config.targetPrice;
    if (price !== null && price > 0) {
      const reached = price <= target;
      const gap = Math.max(price - target, 0);
      const gapPct = (price - target) / price;

      targetInfo = {
        amount: target,
        gap,
        gapPct,
        reached,
      };

      if (inStock && !isStale) {
        sortKey = Math.max(gapPct, 0);
      } else {
        sortKey = 2;
      }
    } else {
      targetInfo = {
        amount: target,
        gap: 0,
        gapPct: 0,
        reached: false,
      };
      sortKey = 2;
    }
  } else {
    sortKey = inStock && !isStale ? 1 : 2;
  }

  // 2. Price change since tracking started
  let changeSinceStart: WatchView["changeSinceStart"] = null;
  if (state.baselinePrice !== null && price !== null) {
    const diff = price - state.baselinePrice;
    const pct = diff / state.baselinePrice;
    changeSinceStart = {
      amount: diff,
      pct,
      since: createdAt,
    };
  }

  // 3. Condition states
  const triMap = evaluateConditions(config, state, snapshot);
  const conditions: Array<{ key: ConditionKey; state: Tri }> = [];

  const keys: ConditionKey[] = [
    "target_price",
    "drop_pct",
    "low",
    "deal_score",
    "back_in_stock",
  ];

  for (const k of keys) {
    if (k in triMap && triMap[k] !== undefined) {
      conditions.push({ key: k, state: triMap[k]! });
    }
  }

  // 4. Alert state
  let alertStatus: WatchView["alertStatus"] = { kind: "none" };

  if (latestAlert) {
    const sentDeliveries = latestAlert.deliveries.filter(
      (d) => d.status === "sent",
    );
    const pendingDeliveries = latestAlert.deliveries.filter(
      (d) => d.status === "pending" || d.status === "sending",
    );

    if (sentDeliveries.length > 0) {
      const sentChannels = Array.from(
        new Set(sentDeliveries.map((d) => d.channel)),
      );
      alertStatus = {
        kind: "sent",
        at: sentDeliveries[0].sentAt ?? latestAlert.createdAt,
        channels: sentChannels,
      };
    } else if (pendingDeliveries.length > 0) {
      const reason: ScheduledReason =
        settings.frequency === "instant" ? "quiet_hours" : settings.frequency;
      alertStatus = {
        kind: "scheduled",
        deliverAfter: latestAlert.deliverAfter,
        reason,
        text: scheduledText(reason, latestAlert.deliverAfter),
      };
    }
  }

  return {
    price,
    inStock,
    isStale,
    observedAt: snapshot.observedAt,
    deal: snapshot.deal,
    target: targetInfo,
    changeSinceStart,
    change7d: priceChange(price, snapshot.price7dAgo ?? null, CHANGE_WINDOW_DAYS),
    conditions,
    priceHike: config.notifyPriceHike ? { active: state.hikeActive === true } : null,
    alertStatus,
    sortKey,
  };
}
