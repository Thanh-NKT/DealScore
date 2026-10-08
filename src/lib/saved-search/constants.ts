/**
 * Saved searches + alert (roadmap P4 item E). Thresholds — tune with real data.
 * 10 is mirrored by the saved_searches_enforce_limit trigger (0060).
 */
export const MAX_SAVED_SEARCHES = 10;
export const SAVED_SEARCH_NAME_MAX = 60;
/** Results scanned per evaluation: two result pages. */
export const SAVED_SEARCH_SCAN_LIMIT = 48; // tune with real data
export const SAVED_SEARCH_EVAL_INTERVAL_HOURS = 6; // tune with real data
export const SAVED_SEARCH_EVAL_BATCH = 20;
/** At most one alert per saved search per this many hours. */
export const SAVED_SEARCH_COOLDOWN_HOURS = 24; // tune with real data
/** A product that left and re-entered is announced again only after this many days. */
export const SAVED_SEARCH_REALERT_DAYS = 30; // tune with real data
export const SAVED_SEARCH_MAX_ITEMS = 5;
/** A match whose last observation is older than this neither enters nor leaves. */
export const SAVED_SEARCH_STALE_HOURS = 48; // tune with real data
export const SAVED_SEARCH_Q_MAX = 100;
