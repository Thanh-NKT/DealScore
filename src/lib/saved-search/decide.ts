import type { Recommendation } from "@/lib/pricing/deal-score";
import {
  SAVED_SEARCH_COOLDOWN_HOURS,
  SAVED_SEARCH_MAX_ITEMS,
  SAVED_SEARCH_REALERT_DAYS,
  SAVED_SEARCH_STALE_HOURS,
} from "@/lib/saved-search/constants";

/**
 * Saved-search alert decision (roadmap P4 E, spec §2.2). Pure. Never touches decideAlert() / watches.
 * Alerts only when a product ENTERS the match set; what matched when the search was saved is the baseline.
 * tests/lib/saved-search/scenarios.test.ts is the "no spam" commitment for this alert kind.
 */
export interface SavedSearchMatch {
  productId: string;
  variantId: string | null;
  price: number;
  recommendation: Recommendation | null;
  score: number | null;
  lastObservedAt: string | null;
}
export interface SavedSearchHitState {
  productId: string;
  inSet: boolean;
  alertedAt: string | null;
}
export interface SavedSearchState {
  initializedAt: string | null;
  lastAlertedAt: string | null;
  hits: SavedSearchHitState[];
}
export interface HitWrite {
  productId: string;
  inSet: boolean;
  alerted: boolean;
  price: number | null;
}
export type SavedSearchDecision =
  | { kind: "baseline"; hits: HitWrite[] }
  | { kind: "quiet"; hits: HitWrite[] }
  | { kind: "suppressed_cooldown"; hits: HitWrite[] }
  | { kind: "alert"; hits: HitWrite[]; items: SavedSearchMatch[]; totalNew: number };

const HOUR = 3_600_000;

export function isFreshMatch(m: Pick<SavedSearchMatch, "lastObservedAt">, now: Date, staleHours = SAVED_SEARCH_STALE_HOURS): boolean {
  if (!m.lastObservedAt) return false;
  const t = Date.parse(m.lastObservedAt);
  return Number.isFinite(t) && now.getTime() - t <= staleHours * HOUR;
}

/**
 * `scan.complete` = `matches` is the WHOLE match set. When it is false (more than SAVED_SEARCH_MATCH_CAP products
 * match), what was not read is unknown: nothing leaves, and a product never seen before joins the set quietly
 * (it may only have been pushed into the window). Only a product seen LEAVING (in_set = false) may then alert.
 */
export function decideSavedSearch(
  state: SavedSearchState,
  matches: SavedSearchMatch[],
  now: Date,
  scan: { complete: boolean } = { complete: true },
): SavedSearchDecision {
  // One row per product (a search page never repeats one, but be safe).
  const byId = new Map<string, SavedSearchMatch>();
  for (const m of matches) if (!byId.has(m.productId)) byId.set(m.productId, m);
  const all = [...byId.values()];
  const fresh = all.filter((m) => isFreshMatch(m, now));
  const matchedIds = new Set(all.map((m) => m.productId));

  // Baseline = EVERY match, stale ones included: whatever matched when the search was saved is never news.
  // The stale rule only applies to entering / leaving afterwards (P4 review I2).
  if (!state.initializedAt) {
    return { kind: "baseline", hits: all.map((m) => ({ productId: m.productId, inSet: true, alerted: false, price: m.price })) };
  }

  const hits = new Map(state.hits.map((h) => [h.productId, h]));
  const outside = fresh.filter((m) => !hits.get(m.productId)?.inSet);
  // Truncated scan: a never-seen product is absorbed (written in the set, never announced).
  const absorbed = scan.complete ? [] : outside.filter((m) => !hits.has(m.productId));
  const entering = scan.complete ? outside : outside.filter((m) => hits.has(m.productId));
  const realertBefore = now.getTime() - SAVED_SEARCH_REALERT_DAYS * 24 * HOUR;
  const isEligible = (m: SavedSearchMatch) => {
    const at = hits.get(m.productId)?.alertedAt;
    return at == null || Date.parse(at) < realertBefore;
  };
  const eligible = entering.filter(isEligible);
  // Leaving: in the set before, not matched now. A stale match is still "matched" (neither enters nor leaves).
  const leaving: HitWrite[] = state.hits
    .filter((h) => scan.complete && h.inSet && !matchedIds.has(h.productId))
    .map((h) => ({ productId: h.productId, inSet: false, alerted: false, price: null }));
  const enterWrite = (m: SavedSearchMatch, alerted = false): HitWrite => ({ productId: m.productId, inSet: true, alerted, price: m.price });

  if (eligible.length === 0) {
    return { kind: "quiet", hits: [...absorbed.map((m) => enterWrite(m)), ...entering.map((m) => enterWrite(m)), ...leaving] };
  }
  if (state.lastAlertedAt && now.getTime() - Date.parse(state.lastAlertedAt) < SAVED_SEARCH_COOLDOWN_HOURS * HOUR) {
    // Entering not written: the edge is kept for the run after the cooldown.
    return { kind: "suppressed_cooldown", hits: [...absorbed.map((m) => enterWrite(m)), ...leaving] };
  }
  const eligibleIds = new Set(eligible.map((m) => m.productId));
  const items = [...eligible].sort((a, b) => a.price - b.price || a.productId.localeCompare(b.productId)).slice(0, SAVED_SEARCH_MAX_ITEMS);
  return {
    kind: "alert",
    items,
    totalNew: eligible.length,
    hits: [...absorbed.map((m) => enterWrite(m)), ...entering.map((m) => enterWrite(m, eligibleIds.has(m.productId))), ...leaving],
  };
}
