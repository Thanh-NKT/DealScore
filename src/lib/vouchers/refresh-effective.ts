import "server-only";
/**
 * Fills offers.effective_price (spec 2026-09-28 §4). Server only — pass the service-role client
 * (offers are written, RLS has no write policy for them).
 *
 * Current price of an offer = its latest valid observation, read with the same RPC the product page
 * uses (`latest_price_per_offer`), so the stored value always matches the price shown next to it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { effectivePriceFor } from "@/lib/vouchers/effective";
import { VOUCHER_FRESH_DAYS } from "@/lib/vouchers/select";
import { listVouchersForListing, toVoucher } from "@/lib/vouchers/store";
import type { Voucher } from "@/lib/vouchers/types";

type Client = SupabaseClient<Database>;

interface ListingRef {
  id: string;
  marketplace: string;
  seller_id: string | null;
}

interface OfferRef {
  id: string;
  listing_id: string;
  variant_id: string;
  effective_price: number | null;
}

/** PostgREST caps a read at 1,000 rows (silently) and ids go in the URL: keep `.in()` lists short. */
const PAGE = 1000;
const ID_CHUNK = 200;
const CONCURRENCY = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function chunks<T>(list: readonly T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Reads every page of a query ordered by a unique key. */
async function readAll<T>(
  what: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read ${what}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

async function pool<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

const LISTING_COLS = "id, marketplace, seller_id";

async function listingsByIds(client: Client, ids: readonly string[], activeOnly: boolean): Promise<ListingRef[]> {
  const out: ListingRef[] = [];
  for (const chunk of chunks(ids)) {
    out.push(
      ...(await readAll<ListingRef>("listings", (from, to) => {
        let q = client.from("listings").select(LISTING_COLS).in("id", chunk);
        if (activeOnly) q = q.eq("status", "active");
        return q.order("id").range(from, to);
      })),
    );
  }
  return out;
}

/**
 * Full run: listings that a fresh voucher can apply to — tied to the listing, to its seller (shop
 * vouchers) or marketplace-wide (platform / payment) — plus listings whose offers still carry a
 * value, so a voucher that disappeared clears it.
 */
async function listingsInScope(client: Client, vouchers: readonly Voucher[]): Promise<ListingRef[]> {
  const direct = new Set<string>();
  const sellers = new Set<string>();
  const markets = new Set<string>();
  for (const v of vouchers) {
    if (v.kind === "shipping") continue; // gives nothing at fee 0
    if (v.listingId) direct.add(v.listingId);
    else if (v.sellerId) sellers.add(v.sellerId);
    else markets.add(v.marketplace);
  }

  const found = new Map<string, ListingRef>();
  const add = (rows: ListingRef[]) => rows.forEach((l) => found.set(l.id, l));

  for (const m of markets) {
    add(
      await readAll<ListingRef>("listings", (from, to) =>
        client.from("listings").select(LISTING_COLS).eq("marketplace", m).eq("status", "active").order("id").range(from, to),
      ),
    );
  }
  for (const chunk of chunks([...sellers])) {
    add(
      await readAll<ListingRef>("listings", (from, to) =>
        client.from("listings").select(LISTING_COLS).in("seller_id", chunk).eq("status", "active").order("id").range(from, to),
      ),
    );
  }
  add(await listingsByIds(client, [...direct].filter((id) => !found.has(id)), true));

  const withValue = await readAll<{ listing_id: string }>("offers", (from, to) =>
    client.from("offers").select("listing_id").not("effective_price", "is", null).order("id").range(from, to),
  );
  add(await listingsByIds(client, [...new Set(withValue.map((o) => o.listing_id))].filter((id) => !found.has(id)), false));

  return [...found.values()];
}

async function loadFreshVouchers(client: Client, now: Date): Promise<Voucher[]> {
  const since = new Date(now.getTime() - VOUCHER_FRESH_DAYS * 86_400_000).toISOString();
  const rows = await readAll<Database["public"]["Tables"]["vouchers"]["Row"]>("vouchers", (from, to) =>
    client.from("vouchers").select("*").gte("last_seen_at", since).order("id").range(from, to),
  );
  return rows.map(toVoucher);
}

/** Candidate vouchers per listing from one preloaded list (activeVouchers() does the exact scoping). */
function indexVouchers(list: readonly Voucher[]): (l: ListingRef) => Voucher[] {
  const byListing = new Map<string, Voucher[]>();
  const bySeller = new Map<string, Voucher[]>();
  const byMarket = new Map<string, Voucher[]>();
  const push = (m: Map<string, Voucher[]>, k: string, v: Voucher) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const v of list) {
    if (v.listingId) push(byListing, v.listingId, v);
    else if (v.sellerId) push(bySeller, v.sellerId, v);
    else push(byMarket, v.marketplace, v);
  }
  return (l) => [
    ...(byListing.get(l.id) ?? []),
    ...(l.seller_id ? (bySeller.get(l.seller_id) ?? []) : []),
    ...(byMarket.get(l.marketplace) ?? []),
  ];
}

async function offersOf(client: Client, listingIds: readonly string[]): Promise<OfferRef[]> {
  const out: OfferRef[] = [];
  for (const chunk of chunks(listingIds)) {
    const rows = await readAll("offers", (from, to) =>
      client
        .from("offers")
        .select("id, listing_id, variant_id, effective_price")
        .in("listing_id", chunk)
        .not("variant_id", "is", null)
        .order("id")
        .range(from, to),
    );
    for (const r of rows) {
      out.push({
        id: r.id,
        listing_id: r.listing_id,
        variant_id: r.variant_id!,
        effective_price: r.effective_price != null ? Number(r.effective_price) : null,
      });
    }
  }
  return out;
}

/** offerId → current price (latest valid observation), via the product page's RPC. */
async function currentPrices(client: Client, variantIds: readonly string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  await pool(variantIds, async (variantId) => {
    const { data, error } = await client.rpc("latest_price_per_offer", { p_variant_id: variantId });
    if (error) throw new Error(`latest_price_per_offer failed: ${error.message}`);
    for (const r of data ?? []) {
      const p = r.price != null ? Number(r.price) : null;
      if (p != null && p > 0) prices.set(r.offer_id, p);
    }
  });
  return prices;
}

/**
 * Recomputes offers.effective_price for `listingIds` (default: every listing a fresh voucher can
 * apply to, plus those still carrying a value). Offers of processed listings that no longer get a
 * value are cleared. Returns the number of offers written.
 */
export async function refreshEffectivePrices(
  client: Client,
  opts: { listingIds?: string[]; now?: Date } = {},
): Promise<{ updated: number }> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();

  let listings: ListingRef[];
  let vouchersFor: (l: ListingRef) => Promise<Voucher[]>;
  if (opts.listingIds) {
    const ids = [...new Set(opts.listingIds.filter((id) => UUID_RE.test(id)))];
    if (ids.length === 0) return { updated: 0 };
    listings = await listingsByIds(client, ids, false);
    vouchersFor = (l) => listVouchersForListing(client, { marketplace: l.marketplace, listingId: l.id, sellerId: l.seller_id, now });
  } else {
    const fresh = await loadFreshVouchers(client, now);
    listings = await listingsInScope(client, fresh);
    const lookup = indexVouchers(fresh);
    vouchersFor = async (l) => lookup(l);
  }
  if (listings.length === 0) return { updated: 0 };

  const offers = await offersOf(client, listings.map((l) => l.id));
  if (offers.length === 0) return { updated: 0 };
  const prices = await currentPrices(client, [...new Set(offers.map((o) => o.variant_id))]);

  const listingById = new Map(listings.map((l) => [l.id, l]));
  const voucherLists = new Map<string, Voucher[]>();
  const offerListingIds = [...new Set(offers.map((o) => o.listing_id))];
  const lists = await pool(offerListingIds, (id) => vouchersFor(listingById.get(id)!));
  offerListingIds.forEach((id, i) => voucherLists.set(id, lists[i]));

  const setTo = new Map<number, string[]>(); // value → offer ids
  const clear: string[] = [];
  for (const o of offers) {
    const l = listingById.get(o.listing_id)!;
    const price = prices.get(o.id);
    const value =
      price != null
        ? effectivePriceFor(price, voucherLists.get(o.listing_id) ?? [], {
            now,
            marketplace: l.marketplace,
            listingId: l.id,
            sellerId: l.seller_id,
          })
        : null;
    if (value != null) setTo.set(value, [...(setTo.get(value) ?? []), o.id]);
    else if (o.effective_price != null) clear.push(o.id);
  }

  let updated = 0;
  const write = async (ids: string[], patch: Database["public"]["Tables"]["offers"]["Update"]) => {
    for (const chunk of chunks(ids)) {
      const { error } = await client.from("offers").update(patch).in("id", chunk);
      if (error) throw new Error(`Failed to update offers.effective_price: ${error.message}`);
      updated += chunk.length;
    }
  };
  await pool([...setTo.entries()], ([value, ids]) => write(ids, { effective_price: value, effective_price_at: nowIso }));
  await write(clear, { effective_price: null, effective_price_at: null });
  return { updated };
}
