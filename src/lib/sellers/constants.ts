/** Seller price-behaviour profile (roadmap P4 item H). Thresholds — tune with real data. */
export const SELLER_PROFILE_WINDOW_DAYS = 90; // mirrored by seller_offer_ids (0064)
/** An offer counts for stability only with this many days of prices. */
export const SELLER_MIN_OFFER_DAYS = 14; // tune with real data
export const SELLER_MIN_TRACKED_OFFERS = 3; // tune with real data
export const SELLER_MIN_CLAIM_WEEKS = 10; // tune with real data
export const SELLER_MIN_CLAIM_OFFERS = 3; // tune with real data
/** (max − min) / median of an offer's daily low below this = "gần như không đổi giá". */
export const SELLER_STABLE_SWING = 0.05; // tune with real data
/** A profile older than this is hidden (the job refreshes weekly). */
export const SELLER_PROFILE_MAX_AGE_DAYS = 8;
/** The job recomputes a profile once it is this old. */
export const SELLER_PROFILE_REFRESH_DAYS = 7;
export const SELLER_PROFILE_VERSION = "h1";
/** Variant rollup days read for the hike windows: 90 + 74. */
export const SELLER_ROLLUP_DAYS = 164;
