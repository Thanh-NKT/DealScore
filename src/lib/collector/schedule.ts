/**
 * Which listings the collector refreshes this run (1.10). Pure.
 *
 * listings.refresh_priority: 1 = highest. Listings with an active Watch are refreshed at the
 * priority-1 rate whatever their stored priority — alerts are only as fresh as their prices.
 */

import type { MarketplaceId } from "@/lib/marketplaces/types";

export const REFRESH_INTERVAL_HOURS: Record<1 | 2 | 3, number> = { 1: 2, 2: 6, 3: 24 };
const SLOWEST_INTERVAL_HOURS = REFRESH_INTERVAL_HOURS[3];
const MS_PER_HOUR = 3_600_000;

export interface CollectorListing {
  id: string;
  marketplace: MarketplaceId;
  externalItemId: string;
  refreshPriority: number;
  lastObservedAt: string | null;
  watched: boolean;
}

function intervalHours(l: CollectorListing): number {
  if (l.watched) return REFRESH_INTERVAL_HOURS[1];
  return REFRESH_INTERVAL_HOURS[l.refreshPriority as 1 | 2 | 3] ?? SLOWEST_INTERVAL_HOURS;
}

/** Age / refresh interval. ≥ 1 means due. Never observed → Infinity. */
export function overdueRatio(l: CollectorListing, now: Date): number {
  if (!l.lastObservedAt) return Infinity;
  const ageHours = (now.getTime() - new Date(l.lastObservedAt).getTime()) / MS_PER_HOUR;
  return ageHours / intervalHours(l);
}

export function selectDueListings(listings: CollectorListing[], now: Date, limit: number): CollectorListing[] {
  return listings
    .map((l) => ({ l, ratio: overdueRatio(l, now) }))
    .filter((x) => x.ratio >= 1)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, limit)
    .map((x) => x.l);
}

/** Share of failed items in a run; 0 when nothing ran. The G1 gate is < 5%. */
export function errorRate(ok: number, failed: number): number {
  const total = ok + failed;
  return total === 0 ? 0 : failed / total;
}
