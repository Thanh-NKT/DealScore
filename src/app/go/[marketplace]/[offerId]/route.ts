import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildAffiliateUrl, encodeSubId, type ClickSource } from "@/lib/affiliate/link";
import { getAdapter, type MarketplaceAdapter } from "@/lib/marketplaces";
import { clientIp, hashIp } from "@/lib/rate-limit";

interface RouteProps {
  params: Promise<{ marketplace: string; offerId: string }>;
}

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_COOKIE = "dealscore_sid";
const SOURCES: readonly ClickSource[] = ["web", "extension", "email", "push"];

/**
 * Allowed redirect targets: the hosts of the listing's OWN marketplace (src/lib/marketplaces).
 * Second line of defense: even if affiliate data is tampered with, /go never becomes an open
 * redirect from our domain to a scam page — nor to another marketplace.
 */
function isAllowedTarget(raw: string, adapter: MarketplaceAdapter): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.port === "" && adapter.targetHosts.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE });
}

/** Click rows written per IP per hour; beyond that /go still redirects, without a click row. */
const GO_CLICKS_PER_HOUR = 120;

/**
 * watch_id / alert_event_id from the query string are attached only when they check out: the alert
 * exists for THIS offer (and that watch, when one is given) — what an email link carries, signed in or
 * not — or the watch belongs to the signed-in user. Anything else is dropped, so a crafted link cannot
 * attribute clicks to other people's watches or alerts.
 */
async function attributionRefs(
  supabase: ReturnType<typeof createAdminClient>,
  p: { offerId: string; watchId: string | null; alertEventId: string | null; userId: string | null },
): Promise<{ watch_id: string | null; alert_event_id: string | null }> {
  const none = { watch_id: null, alert_event_id: null };
  if (!p.watchId && !p.alertEventId) return none;
  try {
    const [alert, watch] = await Promise.all([
      p.alertEventId
        ? supabase.from("alert_events").select("watch_id, offer_id").eq("id", p.alertEventId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      p.watchId && p.userId
        ? supabase.from("watches").select("user_id").eq("id", p.watchId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const alertOk =
      alert.data != null && alert.data.offer_id === p.offerId && (!p.watchId || alert.data.watch_id === p.watchId);
    const watchOk = p.watchId != null && ((alertOk && alert.data?.watch_id === p.watchId) || (watch.data != null && watch.data.user_id === p.userId));
    return { watch_id: watchOk ? p.watchId : null, alert_event_id: alertOk ? p.alertEventId : null };
  } catch (err) {
    console.error("/go: attribution check failed:", err instanceof Error ? err.message : err);
    return none;
  }
}

let warnedMissingAffiliateId = false;

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { marketplace, offerId } = await params;
  const { searchParams } = new URL(request.url);

  // offerId goes straight into a uuid column: a junk value makes the query fail → 500 instead of 404.
  if (!UUID_RE.test(offerId)) return notFound("Không tìm thấy offer");
  const adapter = getAdapter(marketplace);
  if (!adapter) return notFound("Không tìm thấy offer");

  const rawSrc = searchParams.get("src");
  const source: ClickSource = SOURCES.includes(rawSrc as ClickSource) ? (rawSrc as ClickSource) : "web";
  const rawWatch = searchParams.get("watch");
  const watchId = rawWatch && UUID_RE.test(rawWatch) ? rawWatch : null;
  const rawAlert = searchParams.get("alert");
  const alertEventId = rawAlert && UUID_RE.test(rawAlert) ? rawAlert : null;

  try {
    const supabase = createAdminClient();

    // 1. Offer + listing + affiliate override
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(`id, match_status, listings ( url, marketplace, status ), affiliate_offers ( eligible, short_link )`)
      .eq("id", offerId)
      .maybeSingle();
    if (offerError) throw new Error(`Failed to read offer: ${offerError.message}`);
    // A non-existent offer is a 404 — don't push the user to the marketplace with a meaningless query.
    if (!offer) return notFound("Không tìm thấy offer");

    const listing = Array.isArray(offer.listings) ? offer.listings[0] : offer.listings;
    const aff = Array.isArray(offer.affiliate_offers) ? offer.affiliate_offers[0] : offer.affiliate_offers;

    // /go/shopee/{id of another marketplace's offer} is a bad link — never redirect to the wrong marketplace.
    if (!listing || listing.marketplace !== marketplace) return notFound("Không tìm thấy offer");
    // The product page doesn't show these offers, so don't send users to them either.
    if (offer.match_status === "rejected" || listing.status !== "active") {
      return notFound("Offer không còn được theo dõi");
    }
    if (!listing.url || !isAllowedTarget(listing.url, adapter)) {
      console.error(`/go: listings.url outside allowlist for offer ${offerId}: ${listing.url}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    // 2. Record the click FIRST — its id is needed for sub_id.
    const { data: auth } = await (await createClient()).auth.getUser();
    const userId = auth.user?.id ?? null;
    // Only our own UUID cookie: an arbitrary value would land in click_events.session_id unbounded.
    const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
    const sessionOk = rawSession != null && UUID_RE.test(rawSession);
    const sessionId = sessionOk ? rawSession : crypto.randomUUID();

    let clickRes: { data: { id: string } | null; error: { message: string; code?: string } | null } = { data: null, error: null };
    // Per-IP throttle on click writes (bots, scripted pollution). Over the limit the user still gets
    // the purchase link, only without a click row. A throttle failure never blocks the purchase.
    let underLimit = true;
    try {
      const { data, error: limitError } = await supabase.rpc("rate_hit", {
        p_key: `go:${hashIp(clientIp(request.headers))}`,
        p_window_seconds: 3600,
        p_limit: GO_CLICKS_PER_HOUR,
      });
      if (limitError) console.error("/go: rate_hit failed:", limitError.message);
      else underLimit = data !== false;
    } catch (err) {
      console.error("/go: rate_hit failed:", err instanceof Error ? err.message : err);
    }
    if (underLimit) {
      const refs = await attributionRefs(supabase, { offerId, watchId, alertEventId, userId });
      const click = { offer_id: offerId, source, ...refs, user_id: userId, session_id: sessionId };
      clickRes = await supabase.from("click_events").insert(click).select("id").single();
      // watch / alert deleted meanwhile (FK) — still record the click, drop those two references.
      if (clickRes.error?.code === "23503" && (refs.watch_id || refs.alert_event_id)) {
        clickRes = await supabase
          .from("click_events")
          .insert({ ...click, watch_id: null, alert_event_id: null })
          .select("id")
          .single();
      }
      if (clickRes.error) {
        // Never block a purchase because logging failed (A4) — we only lose attribution for this one.
        console.error(`/go: failed to write click_events for offer ${offerId}:`, clickRes.error.message);
      }
    }

    // 3. Build the link.
    const affiliateId = process.env.SHOPEE_AFFILIATE_ID || null;
    if (!affiliateId && !warnedMissingAffiliateId) {
      warnedMissingAffiliateId = true;
      console.warn("/go: SHOPEE_AFFILIATE_ID missing — every purchase uses the plain link, no commission");
    }
    // Affiliate links exist only for Shopee so far; other marketplaces get the plain product link.
    const target = adapter.id !== "shopee" ? { url: listing.url, kind: "origin" as const } : buildAffiliateUrl({
      mode: process.env.AFFILIATE_LINK_MODE === "short_link" ? "short_link" : "an_redir",
      originUrl: listing.url,
      affiliateId,
      subId: encodeSubId(clickRes.data?.id ?? null, source),
      shortLink: aff?.short_link ?? null,
      eligible: aff?.eligible ?? true,
    });
    if (!isAllowedTarget(target.url, adapter)) {
      console.error(`/go: redirect target outside allowlist for offer ${offerId}: ${target.url}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    const response = NextResponse.redirect(target.url, { status: 302, headers: NO_STORE });
    if (!sessionOk) {
      // Session cookie (no max-age): only groups clicks within one browsing session.
      response.cookies.set(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }
    return response;
  } catch (err) {
    // Infrastructure errors must show up as errors, never disguised as a redirect.
    console.error(`/go/${marketplace}/${offerId} redirect error:`, err);
    return NextResponse.json({ error: "Không xử lý được liên kết" }, { status: 500, headers: NO_STORE });
  }
}
