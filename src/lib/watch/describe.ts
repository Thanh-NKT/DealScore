import type { Channel, NotificationSettings } from "@/lib/account/notification-settings";
import { evaluateConditions } from "@/lib/watch/conditions";
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
  conditions: Array<{ key: ConditionKey; state: Tri }>;
  alertStatus:
    | { kind: "none" }
    | { kind: "sent"; at: string; channels: Channel[] }
    | {
        kind: "scheduled";
        deliverAfter: string;
        reason: "quiet_hours" | "daily_digest";
      };
  sortKey: number;
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

  // 1. Khoảng cách tới target
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

  // 2. Thay đổi giá từ lúc bắt đầu theo dõi
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

  // 3. Trạng thái các điều kiện
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

  // 4. Trạng thái alert
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
      const reason =
        settings.frequency === "daily_digest" ? "daily_digest" : "quiet_hours";
      alertStatus = {
        kind: "scheduled",
        deliverAfter: latestAlert.deliverAfter,
        reason,
      };
    }
  }

  return {
    price,
    inStock,
    isStale,
    target: targetInfo,
    changeSinceStart,
    conditions,
    alertStatus,
    sortKey,
  };
}
