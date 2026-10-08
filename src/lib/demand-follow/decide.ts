import type { SavedSearchMatch } from "@/lib/saved-search/decide";
import { isFreshMatch } from "@/lib/saved-search/decide";
import { DEMAND_FOUND_FRESH_HOURS, DEMAND_FOUND_MAX_ITEMS } from "@/lib/demand-follow/constants";

/** One-shot follow decision (spec §3.2). Pure. An expired follow never alerts, even if results appeared. */
export interface DemandFollowState {
  keyword: string;
  knownProductIds: string[];
  expiresAt: string;
}
export type DemandFollowDecision =
  | { kind: "expire" }
  | { kind: "wait" }
  | { kind: "found"; items: SavedSearchMatch[]; totalNew: number };

export function decideDemandFollow(f: DemandFollowState, results: SavedSearchMatch[], now: Date): DemandFollowDecision {
  if (now.getTime() >= Date.parse(f.expiresAt)) return { kind: "expire" };
  const known = new Set(f.knownProductIds);
  const seen = new Set<string>();
  const fresh = results.filter((r) => {
    if (known.has(r.productId) || seen.has(r.productId)) return false;
    seen.add(r.productId);
    return isFreshMatch(r, now, DEMAND_FOUND_FRESH_HOURS);
  });
  if (fresh.length === 0) return { kind: "wait" };
  const items = [...fresh].sort((a, b) => a.price - b.price || a.productId.localeCompare(b.productId)).slice(0, DEMAND_FOUND_MAX_ITEMS);
  return { kind: "found", items, totalNew: fresh.length };
}
