import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { beginLookup, clientIp, finishLookup, hashIp } from "@/lib/rate-limit";
import { getAdapter, MARKETPLACES, MarketplaceUnavailableError } from "@/lib/marketplaces";
import { saveListingExtras } from "@/lib/listing-extras";
import { canRefreshVouchers } from "@/lib/vouchers/refresh";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * POST /api/vouchers/refresh { offerId } — re-read images + vouchers for the offer's listing from
 * the listing's marketplace (adapter.fetchListingDetail). Counts against the lookup quota (per IP /
 * per user, src/lib/rate-limit.ts). 503 { error: "not_configured" } when that marketplace has no
 * data source yet (canRefreshVouchers).
 */
export async function POST(request: NextRequest) {
  let offerId: unknown;
  try {
    offerId = (await request.json())?.offerId;
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  if (typeof offerId !== "string" || !UUID_RE.test(offerId)) return json({ error: "bad_request" }, 400);

  // No marketplace can refresh at all: answer before spending the caller's lookup quota.
  if (!MARKETPLACES.some((m) => canRefreshVouchers(m.id))) return json({ error: "not_configured" }, 503);

  let requestId: number | null = null;
  try {
    const { data: auth } = await (await createClient()).auth.getUser();
    const verdict = await beginLookup({ ipHash: hashIp(clientIp(request.headers)), userId: auth.user?.id ?? null });
    if (!verdict.allowed) {
      return json({ error: "rate_limited", retryAfter: verdict.retryAfterSeconds }, 429, {
        "Retry-After": String(verdict.retryAfterSeconds ?? 3600),
      });
    }
    requestId = verdict.requestId;

    const admin = createAdminClient();
    const { data: offer, error } = await admin
      .from("offers")
      .select("id, listings!inner ( id, marketplace, external_item_id )")
      .eq("id", offerId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read offer: ${error.message}`);
    const listing = offer?.listings;
    if (!listing) {
      if (requestId != null) await finishLookup(requestId, "rejected");
      return json({ error: "not_found" }, 404);
    }
    // Same rule the product page uses to decide whether to offer "Làm mới".
    if (!canRefreshVouchers(listing.marketplace)) {
      if (requestId != null) await finishLookup(requestId, "rejected");
      return json({ error: "not_configured" }, 503);
    }

    const detail = await getAdapter(listing.marketplace)!.fetchListingDetail!(listing.external_item_id);
    // Also refreshes this listing's effective prices (end of saveListingExtras) — no second call here.
    const saved = await saveListingExtras(admin, listing.id, {
      images: detail.images,
      vouchers: detail.vouchers,
      source: detail.source,
    });

    if (requestId != null) await finishLookup(requestId, "resolved");
    return json({ status: "ok", ...saved }, 200);
  } catch (err) {
    if (requestId != null) await finishLookup(requestId, "error");
    if (err instanceof MarketplaceUnavailableError) {
      return json({ error: "upstream_unavailable" }, 503);
    }
    console.error("api/vouchers/refresh failed:", err);
    return json({ error: "internal" }, 500);
  }
}
