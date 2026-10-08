/**
 * "Sản phẩm bạn tìm đã có" (roadmap P4 item F). Thresholds — tune with real data.
 * 10 is mirrored by the demand_follows_enforce_limit trigger (0060); 30-day retention by prune_operational_data.
 */
export const MAX_DEMAND_FOLLOWS = 10;
export const DEMAND_FOLLOW_TTL_DAYS = 30; // tune with real data
/** Same cadence as the demand-only sourcing pass (kairo/dealscore-sourcing-demand, every 3 h). */
export const DEMAND_FOLLOW_CHECK_INTERVAL_HOURS = 3;
export const DEMAND_FOLLOW_CHECK_BATCH = 20;
export const DEMAND_FOUND_MAX_ITEMS = 3;
/** At most one demand_found alert per user per this many hours. */
export const DEMAND_FOUND_USER_COOLDOWN_HOURS = 24; // tune with real data
export const DEMAND_FOLLOW_RETENTION_DAYS = 30;
/** A result whose last observation is older than this does not count as "found". */
export const DEMAND_FOUND_FRESH_HOURS = 48; // tune with real data
/** Results read per check. */
export const DEMAND_FOLLOW_SCAN_LIMIT = 24;
