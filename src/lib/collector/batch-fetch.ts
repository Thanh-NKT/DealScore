import { MarketplaceItemNotFoundError, type MarketplaceId, type MarketplaceItem } from "@/lib/marketplaces/types";

export type FetchOne = (marketplace: MarketplaceId, externalItemId: string) => Promise<MarketplaceItem>;
/** null = this marketplace has no batch API (fall back to FetchOne). */
export type FetchMany = (marketplace: MarketplaceId, externalItemIds: string[]) => Promise<Map<string, MarketplaceItem>> | null;

type Queued = { marketplace: MarketplaceId; externalItemId: string };

/**
 * Fetch for the listing at `index` of `queue`. On a marketplace with a batch API, the first miss fetches it
 * together with the next same-marketplace listings of the queue (up to `batchSize` ids); those are then
 * served from that call. An id missing from the batch result is MarketplaceItemNotFoundError, like fetchOne.
 * A failed batch fails each of its listings with the same error when (and if) the collector reaches them.
 */
export function batchedFetcher(queue: Queued[], fetchOne: FetchOne, fetchMany: FetchMany, batchSize: number) {
  const prefetched = new Map<string, Promise<MarketplaceItem>>();
  const key = (m: MarketplaceId, id: string) => `${m}:${id}`;

  return (index: number): Promise<MarketplaceItem> => {
    const { marketplace, externalItemId } = queue[index];
    const own = key(marketplace, externalItemId);
    const hit = prefetched.get(own);
    if (hit) {
      prefetched.delete(own);
      return hit;
    }

    const ids = [externalItemId];
    for (let j = index + 1; j < queue.length && ids.length < batchSize; j++) {
      const next = queue[j];
      if (next.marketplace !== marketplace || ids.includes(next.externalItemId)) continue;
      if (!prefetched.has(key(marketplace, next.externalItemId))) ids.push(next.externalItemId);
    }
    const all = fetchMany(marketplace, ids);
    if (!all) return fetchOne(marketplace, externalItemId);

    const pick = (id: string) =>
      all.then((found) => {
        const item = found.get(id);
        if (!item) throw new MarketplaceItemNotFoundError(`${marketplace} item ${id} not found`);
        return item;
      });
    for (const id of ids.slice(1)) {
      const p = pick(id);
      // Listings the run never reaches (deadline, marketplace aborted) must not surface as unhandled rejections.
      p.catch(() => {});
      prefetched.set(key(marketplace, id), p);
    }
    return pick(externalItemId);
  };
}
