/**
 * Listing extras (spec 2026-09-26 §1 + §5): images and vouchers read next to a price, from the
 * marketplace API or the Chrome extension. Server only — pass the service-role client.
 *
 * Inputs are raw and untrusted: images go through sanitizeImageUrls(), vouchers through
 * normalizeVoucher() bound to this listing's own marketplace / seller.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { sanitizeImageUrls } from "@/lib/product/images";
import { normalizeVouchers } from "@/lib/vouchers/normalize";
import { upsertVouchers } from "@/lib/vouchers/store";
import type { VoucherSource } from "@/lib/vouchers/types";
import { refreshEffectivePrices } from "@/lib/vouchers/refresh-effective";
import { reportError } from "@/lib/observability";

type Client = SupabaseClient<Database>;

export const MAX_VOUCHERS_PER_SAVE: Record<VoucherSource, number> = { api: 50, seed: 50, extension: 20 };

export interface ListingExtras {
  images?: unknown;
  vouchers?: unknown;
  source: VoucherSource;
  /** Hashed contributor (extension only). */
  reporter?: string | null;
}

/**
 * Ends by refreshing this listing's effective prices; `refreshEffective: false` skips that, for
 * callers that refresh a whole batch themselves (the collector).
 */
export async function saveListingExtras(
  client: Client,
  listingId: string,
  extras: ListingExtras,
  opts: { refreshEffective?: boolean } = {},
): Promise<{ images: number; vouchers: number }> {
  const { data: listing, error } = await client
    .from("listings")
    .select("id, marketplace, seller_id, images")
    .eq("id", listingId)
    .maybeSingle();
  if (error) throw new Error(`Failed to read listing: ${error.message}`);
  if (!listing) return { images: 0, vouchers: 0 };

  let images = 0;
  const clean = sanitizeImageUrls(extras.images, listing.marketplace);
  // API/seed data is authoritative and replaces the list; extension reports only fill an empty one.
  // An empty API answer never wipes images we already have.
  const mayWrite = extras.source === "extension" ? (listing.images ?? []).length === 0 : true;
  if (clean.length > 0 && mayWrite) {
    const { error: iErr } = await client.from("listings").update({ images: clean }).eq("id", listingId);
    if (iErr) throw new Error(`Failed to save listing images: ${iErr.message}`);
    images = clean.length;
  }

  const inputs = normalizeVouchers(
    extras.vouchers,
    { marketplace: listing.marketplace, listingId: listing.id, sellerId: listing.seller_id },
    MAX_VOUCHERS_PER_SAVE[extras.source],
  );
  const vouchers = await upsertVouchers(client, inputs, {
    source: extras.source,
    reporter: extras.source === "extension" ? (extras.reporter ?? null) : null,
  });

  // The effective price is derived data: a failure here never fails the save.
  if (opts.refreshEffective !== false) {
    try {
      await refreshEffectivePrices(client, { listingIds: [listing.id] });
    } catch (err) {
      reportError(err, { where: "saveListingExtras.refreshEffectivePrices", listingId: listing.id });
    }
  }

  return { images, vouchers };
}
