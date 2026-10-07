import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { WatchBuyTarget } from "@/lib/watch/links";

/**
 * "Liên kết tiếp thị" disclosure for outbound buttons. Display only: it never feeds Deal Score, search, alerts or
 * the watch engine (those modules may not read affiliate data — tests/lib/affiliate/no-bias.test.ts).
 */

/** Offer ids per read: far below PostgREST's 1,000-row cap. */
const CHUNK = 200;

/** Offer ids whose affiliate_offers row is eligible (public-read columns offer_id / eligible). Throws on a read error. */
export async function eligibleAffiliateOffers(client: SupabaseClient<Database>, offerIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(offerIds)];
  const eligible = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client
      .from("affiliate_offers")
      .select("offer_id, eligible")
      .in("offer_id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`Failed to read affiliate_offers: ${error.message}`);
    for (const r of data ?? []) if (r.eligible) eligible.add(r.offer_id);
  }
  return eligible;
}

/** Pure: copy of the items with buy.affiliate set from the eligible offer ids. */
export function withAffiliateDisclosure<T extends { buy: WatchBuyTarget | null }>(items: T[], eligible: ReadonlySet<string>): T[] {
  return items.map((item) =>
    item.buy ? { ...item, buy: { ...item.buy, affiliate: eligible.has(item.buy.offerId) } } : item,
  );
}

/** Convenience for pages: read the eligible set for the items' buy targets and apply it. */
export async function addAffiliateDisclosure<T extends { buy: WatchBuyTarget | null }>(
  client: SupabaseClient<Database>,
  items: T[],
): Promise<T[]> {
  const offerIds = items.flatMap((i) => (i.buy ? [i.buy.offerId] : []));
  if (offerIds.length === 0) return items;
  return withAffiliateDisclosure(items, await eligibleAffiliateOffers(client, offerIds));
}
