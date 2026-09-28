/**
 * Voucher persistence. Writes go through the `upsert_vouchers` RPC, which only the service role may
 * execute — pass the admin client. Reads work with any client (vouchers are public catalog data).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { VOUCHER_FRESH_DAYS } from "@/lib/vouchers/select";
import type { Voucher, VoucherDiscountType, VoucherInput, VoucherKind, VoucherSource } from "@/lib/vouchers/types";

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["vouchers"]["Row"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LIST = 200;

/**
 * Upsert by natural key: a voucher seen again refreshes last_seen_at and, for extension reports,
 * adds `reporter` to `reporters` (unique, at most 20 — enforced in the RPC). Returns rows written.
 */
export async function upsertVouchers(
  client: Client,
  inputs: readonly VoucherInput[],
  opts: { source: VoucherSource; reporter?: string | null },
): Promise<number> {
  if (inputs.length === 0) return 0;
  const items = inputs.map((v) => ({
    marketplace: v.marketplace,
    kind: v.kind,
    sellerId: v.sellerId,
    listingId: v.listingId,
    code: v.code,
    discountType: v.discountType,
    discountValue: v.discountValue,
    maxDiscount: v.maxDiscount,
    minSpend: v.minSpend,
    startsAt: v.startsAt,
    expiresAt: v.expiresAt,
  }));
  const { data, error } = await client.rpc("upsert_vouchers", {
    p_items: items,
    p_source: opts.source,
    // The generated type doesn't know the parameter accepts null.
    p_reporter: (opts.reporter ?? null) as string,
  });
  if (error) throw new Error(`upsert_vouchers failed: ${error.message}`);
  return data ?? 0;
}

export function toVoucher(r: Row): Voucher {
  return {
    id: r.id,
    marketplace: r.marketplace,
    kind: r.kind as VoucherKind,
    sellerId: r.seller_id,
    listingId: r.listing_id,
    code: r.code,
    discountType: r.discount_type as VoucherDiscountType,
    discountValue: Number(r.discount_value),
    maxDiscount: r.max_discount != null ? Number(r.max_discount) : null,
    minSpend: Number(r.min_spend),
    startsAt: r.starts_at,
    expiresAt: r.expires_at,
    source: r.source as VoucherSource,
    reporters: r.reporters ?? [],
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
  };
}

/**
 * Candidate vouchers for a listing: tied to it, to its seller, or marketplace-wide — seen recently.
 * Callers still run activeVouchers() (expiry, reporters rule); this only narrows the query.
 */
export async function listVouchersForListing(
  client: Client,
  params: { marketplace: string; listingId: string; sellerId: string | null; now?: Date },
): Promise<Voucher[]> {
  const { marketplace, listingId, sellerId } = params;
  // Interpolated into a PostgREST filter: accept well-formed ids only.
  if (!UUID_RE.test(listingId) || (sellerId != null && !UUID_RE.test(sellerId))) return [];
  const since = new Date((params.now ?? new Date()).getTime() - VOUCHER_FRESH_DAYS * 86_400_000).toISOString();

  const scope = [
    `listing_id.eq.${listingId}`,
    sellerId
      ? `and(listing_id.is.null,or(seller_id.eq.${sellerId},seller_id.is.null))`
      : "and(listing_id.is.null,seller_id.is.null)",
  ].join(",");

  const { data, error } = await client
    .from("vouchers")
    .select("*")
    .eq("marketplace", marketplace)
    .gte("last_seen_at", since)
    .or(scope)
    .order("last_seen_at", { ascending: false })
    .limit(MAX_LIST);
  if (error) throw new Error(`Failed to read vouchers: ${error.message}`);
  return (data ?? []).map(toVoucher);
}

/** When the newest of these vouchers was last seen (for "cập nhật … trước"). */
export function collectedAt(vouchers: readonly Voucher[]): string | null {
  return vouchers.reduce<string | null>((m, v) => (m == null || v.lastSeenAt > m ? v.lastSeenAt : m), null);
}
