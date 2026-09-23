import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildAffiliateUrl, encodeSubId, type ClickSource } from "@/lib/affiliate/link";

interface RouteProps {
  params: Promise<{ marketplace: string; offerId: string }>;
}

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_COOKIE = "kairo_sid";
const SOURCES: readonly ClickSource[] = ["web", "extension", "email", "push"];

/**
 * Allowed redirect targets. Second line of defense: even if affiliate data
 * is tampered with, /go never becomes an open redirect from our domain to a scam page.
 */
const ALLOWED_TARGET_HOSTS = new Set(["shopee.vn", "www.shopee.vn", "s.shopee.vn", "shope.ee", "shp.ee"]);

function isAllowedTarget(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.port === "" && ALLOWED_TARGET_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE });
}

let warnedMissingAffiliateId = false;

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { marketplace, offerId } = await params;
  const { searchParams } = new URL(request.url);

  // offerId goes straight into a uuid column: a junk value makes the query fail → 500 instead of 404.
  if (!UUID_RE.test(offerId)) return notFound("Không tìm thấy offer");

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
    if (!listing.url || !isAllowedTarget(listing.url)) {
      console.error(`/go: listings.url outside allowlist for offer ${offerId}: ${listing.url}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    // 2. Record the click FIRST — its id is needed for sub_id.
    const { data: auth } = await (await createClient()).auth.getUser();
    const sessionId = request.cookies.get(SESSION_COOKIE)?.value ?? crypto.randomUUID();
    const click = {
      offer_id: offerId,
      source,
      watch_id: watchId,
      alert_event_id: alertEventId,
      user_id: auth.user?.id ?? null,
      session_id: sessionId,
    };
    let clickRes = await supabase.from("click_events").insert(click).select("id").single();
    // watch / alert doesn't exist (FK) — still record the click, drop those two references.
    if (clickRes.error?.code === "23503" && (watchId || alertEventId)) {
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

    // 3. Build the link.
    const affiliateId = process.env.SHOPEE_AFFILIATE_ID || null;
    if (!affiliateId && !warnedMissingAffiliateId) {
      warnedMissingAffiliateId = true;
      console.warn("/go: SHOPEE_AFFILIATE_ID missing — every purchase uses the plain link, no commission");
    }
    const target = buildAffiliateUrl({
      mode: process.env.AFFILIATE_LINK_MODE === "short_link" ? "short_link" : "an_redir",
      originUrl: listing.url,
      affiliateId,
      subId: encodeSubId(clickRes.data?.id ?? null, source),
      shortLink: aff?.short_link ?? null,
      eligible: aff?.eligible ?? true,
    });
    if (!isAllowedTarget(target.url)) {
      console.error(`/go: redirect target outside allowlist for offer ${offerId}: ${target.url}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    const response = NextResponse.redirect(target.url, { status: 302, headers: NO_STORE });
    if (!request.cookies.has(SESSION_COOKIE)) {
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
