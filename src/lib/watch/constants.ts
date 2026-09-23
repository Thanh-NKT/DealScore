/** The one place for Watch & Alert thresholds. */
export const MAX_ACTIVE_WATCHES = 50; // same constant as in the watches_enforce_limit trigger (0006)
export const COOLDOWN_HOURS = 24;
export const DEEPER_DROP_RATIO = 0.03; // a further drop of ≥ 3% below the last alerted price
export const HYSTERESIS_RATIO = 0.02; // a price condition only flips back to "false" after crossing the threshold by another 2%
export const DEAL_SCORE_HYSTERESIS = 2; // points
export const STALE_HOURS = 48; // same as the isStale threshold from 1.2
export const MAX_DELIVERY_ATTEMPTS = 3;
export const RETRY_DELAYS_MINUTES = [5, 30, 120] as const;
