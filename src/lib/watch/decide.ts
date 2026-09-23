import { COOLDOWN_HOURS, DEEPER_DROP_RATIO } from "@/lib/watch/constants";
import { evaluateConditions } from "@/lib/watch/conditions";
import type { ConditionKey, TriggerType, VariantSnapshot, WatchConfig, WatchState } from "@/lib/watch/types";

export interface NextState {
  condState: Partial<Record<ConditionKey, boolean>>;
  lastInStock: boolean | null;
  /** Chỉ khi phải đặt (lần đầu thấy giá) hoặc dời mốc (drop_pct bắn). */
  baselinePrice?: number;
  alerted?: { price: number; at: string };
}

export interface AlertDecision {
  kind: "skip_stale" | "no_alert" | "suppressed_cooldown" | "alert";
  triggerTypes: TriggerType[]; // rỗng trừ khi kind = "alert"
  nextState: NextState | null; // null = không ghi trạng thái (skip_stale)
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

  // Có hàng lại tự nó đã là một cạnh; các điều kiện khác cần lần trước chưa true.
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
    if (v === true || v === false) condState[k] = v; // "unknown" giữ giá trị cũ
  }

  const next: NextState = { condState, lastInStock: snap.inStock };
  if (state.baselinePrice == null && ok) next.baselinePrice = p!;

  if (triggers.length === 0) return { kind: "no_alert", triggerTypes: [], nextState: next };

  const inCooldown =
    state.lastAlertedAt != null &&
    now.getTime() - new Date(state.lastAlertedAt).getTime() < COOLDOWN_HOURS * 3_600_000;

  if (inCooldown) {
    // KHÔNG ghi true cho cạnh vừa bắt được: ghi rồi thì hết cooldown không còn
    // cạnh nào để báo, và alert mất vĩnh viễn (kịch bản B).
    for (const k of newlyTrue) {
      if (state.condState[k] === undefined) delete condState[k];
      else condState[k] = state.condState[k];
    }
    if (newlyTrue.includes("back_in_stock")) next.lastInStock = state.lastInStock;
    return { kind: "suppressed_cooldown", triggerTypes: [], nextState: next };
  }

  next.alerted = { price: p!, at: now.toISOString() };
  if (triggers.includes("drop_pct")) next.baselinePrice = p!; // dời mốc (W3)
  return { kind: "alert", triggerTypes: triggers, nextState: next };
}

/** Phản chiếu đúng những gì record_watch_evaluation ghi vào watches. */
export function applyNextState(state: WatchState, next: NextState | null): WatchState {
  if (!next) return state;
  return {
    baselinePrice: next.baselinePrice ?? state.baselinePrice,
    condState: next.condState,
    lastInStock: next.lastInStock ?? state.lastInStock,
    lastAlertPrice: next.alerted?.price ?? state.lastAlertPrice,
    lastAlertedAt: next.alerted?.at ?? state.lastAlertedAt,
  };
}
