/** Price-season calendar (roadmap P4 item A). Thresholds — tune with real data. */
export const SEASON_HISTORY_DAYS = 400;
export const SEASON_BASELINE_DAYS = 30; // tune with real data
/** Days skipped before a window so a pre-sale hike stays out of the baseline. */
export const SEASON_BASELINE_GAP_DAYS = 7; // tune with real data
export const SEASON_BASELINE_MIN_DAYS = 14; // tune with real data
/** Share of a window's days that need a price for it to count. */
export const SEASON_WINDOW_MIN_SHARE = 0.5; // tune with real data
/** ratio ≤ this counts as "giảm ≥ 5%" in the category share. */
export const SEASON_LOWER_RATIO = 0.95;
/** Days of history before events are ranked against each other. */
export const SEASON_MIN_COVERAGE_DAYS = 300; // tune with real data
export const SEASON_MIN_EVENTS_RANKED = 3;
export const SEASON_UPCOMING_DAYS = 45;
export const SEASON_MIN_VARIANTS_CATEGORY = 8; // tune with real data
export const SEASON_JOB_MAX_VARIANTS = 200; // mirrored by season_variant_ids (0065)
export const SEASON_STATS_REFRESH_DAYS = 7;
