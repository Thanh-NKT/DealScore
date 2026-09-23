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
 * Đích redirect được phép. Lớp phòng thủ thứ hai: kể cả khi dữ liệu affiliate
 * bị sửa, /go không thành open redirect từ domain của mình sang trang lừa đảo.
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

  // offerId đi thẳng vào cột uuid: giá trị rác làm query lỗi → 500 thay vì 404.
  if (!UUID_RE.test(offerId)) return notFound("Không tìm thấy offer");

  const rawSrc = searchParams.get("src");
  const source: ClickSource = SOURCES.includes(rawSrc as ClickSource) ? (rawSrc as ClickSource) : "web";
  const rawWatch = searchParams.get("watch");
  const watchId = rawWatch && UUID_RE.test(rawWatch) ? rawWatch : null;
  const rawAlert = searchParams.get("alert");
  const alertEventId = rawAlert && UUID_RE.test(rawAlert) ? rawAlert : null;

  try {
    const supabase = createAdminClient();

    // 1. Offer + listing + ghi đè affiliate
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(`id, match_status, listings ( url, marketplace, status ), affiliate_offers ( eligible, short_link )`)
      .eq("id", offerId)
      .maybeSingle();
    if (offerError) throw new Error(`Đọc offer thất bại: ${offerError.message}`);
    // Offer không tồn tại là 404 — không đẩy người dùng sang sàn bằng một truy vấn vô nghĩa.
    if (!offer) return notFound("Không tìm thấy offer");

    const listing = Array.isArray(offer.listings) ? offer.listings[0] : offer.listings;
    const aff = Array.isArray(offer.affiliate_offers) ? offer.affiliate_offers[0] : offer.affiliate_offers;

    // /go/shopee/{id của offer sàn khác} là link sai — không redirect nhầm sàn.
    if (!listing || listing.marketplace !== marketplace) return notFound("Không tìm thấy offer");
    // Trang sản phẩm không hiện các offer này, nên cũng không đưa người dùng tới.
    if (offer.match_status === "rejected" || listing.status !== "active") {
      return notFound("Offer không còn được theo dõi");
    }
    if (!listing.url || !isAllowedTarget(listing.url)) {
      console.error(`/go: listings.url ngoài allowlist cho offer ${offerId}: ${listing.url}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    // 2. Ghi click TRƯỚC — cần id của nó cho sub_id.
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
    // watch / alert không tồn tại (FK) — vẫn ghi click, bỏ hai tham chiếu đó.
    if (clickRes.error?.code === "23503" && (watchId || alertEventId)) {
      clickRes = await supabase
        .from("click_events")
        .insert({ ...click, watch_id: null, alert_event_id: null })
        .select("id")
        .single();
    }
    if (clickRes.error) {
      // Không chặn người dùng mua vì lỗi ghi log (A4) — chỉ mất đối soát lượt này.
      console.error(`/go: không ghi được click_events cho offer ${offerId}:`, clickRes.error.message);
    }

    // 3. Dựng link.
    const affiliateId = process.env.SHOPEE_AFFILIATE_ID || null;
    if (!affiliateId && !warnedMissingAffiliateId) {
      warnedMissingAffiliateId = true;
      console.warn("/go: thiếu SHOPEE_AFFILIATE_ID — mọi lượt mua đi link gốc, không có hoa hồng");
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
      console.error(`/go: đích redirect ngoài allowlist cho offer ${offerId}: ${target.url}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    const response = NextResponse.redirect(target.url, { status: 302, headers: NO_STORE });
    if (!request.cookies.has(SESSION_COOKIE)) {
      // Cookie phiên (không có max-age): chỉ để nhóm các click trong một lần duyệt.
      response.cookies.set(SESSION_COOKIE, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }
    return response;
  } catch (err) {
    // Lỗi hạ tầng phải hiện ra là lỗi, không ngụy trang thành một cú redirect.
    console.error(`Lỗi redirect /go/${marketplace}/${offerId}:`, err);
    return NextResponse.json({ error: "Không xử lý được liên kết" }, { status: 500, headers: NO_STORE });
  }
}
