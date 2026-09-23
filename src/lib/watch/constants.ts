/** Một chỗ duy nhất cho các ngưỡng của Watch & Alert. */
export const MAX_ACTIVE_WATCHES = 50; // trùng hằng số trong trigger watches_enforce_limit (0006)
export const COOLDOWN_HOURS = 24;
export const DEEPER_DROP_RATIO = 0.03; // giảm thêm ≥ 3% so với giá vừa báo
export const HYSTERESIS_RATIO = 0.02; // điều kiện giá chỉ về "sai" khi vượt ngưỡng thêm 2%
export const DEAL_SCORE_HYSTERESIS = 2; // điểm
export const STALE_HOURS = 48; // trùng ngưỡng isStale của 1.2
export const MAX_DELIVERY_ATTEMPTS = 3;
export const RETRY_DELAYS_MINUTES = [5, 30, 120] as const;
