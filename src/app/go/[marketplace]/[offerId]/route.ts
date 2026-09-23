import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

interface RouteProps {
  params: Promise<{
    marketplace: string;
    offerId: string;
  }>;
}

const NO_STORE = { "Cache-Control": "no-store" };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_COOKIE = "kairo_sid";

/**
 * Đích redirect được phép. Lớp phòng thủ thứ hai: kể cả khi dữ liệu affiliate
 * bị sửa, /go không thành open redirect từ domain của mình sang trang lừa đảo.
 */
const ALLOWED_TARGET_HOSTS = new Set([
  "shopee.vn",
  "www.shopee.vn",
  "s.shopee.vn",
  "shope.ee",
  "shp.ee",
]);

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

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { marketplace, offerId } = await params;
  const { searchParams } = new URL(request.url);

  // offerId đi thẳng vào cột uuid: giá trị rác làm query lỗi → 500 thay vì 404.
  if (!UUID_RE.test(offerId)) return notFound("Không tìm thấy offer");

  const rawSrc = searchParams.get("src");
  const validSources = ["web", "extension", "email", "push"] as const;
  const source = validSources.includes(rawSrc as "web")
    ? (rawSrc as "web" | "extension" | "email" | "push")
    : "web";

  // watch sai định dạng thì bỏ, không làm hỏng cả lượt ghi click.
  const rawWatch = searchParams.get("watch");
  const watchId = rawWatch && UUID_RE.test(rawWatch) ? rawWatch : null;
  const rawAlert = searchParams.get("alert");
  const alertEventId = rawAlert && UUID_RE.test(rawAlert) ? rawAlert : null;

  try {
    const supabase = createAdminClient();

    // 1. Tìm offer + affiliate_offers + listings
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(`
        id, match_status,
        listings ( url, marketplace, status ),
        affiliate_offers ( short_link, affiliate_url, eligible )
      `)
      .eq("id", offerId)
      .maybeSingle();

    if (offerError) throw new Error(`Đọc offer thất bại: ${offerError.message}`);

    // Offer không tồn tại là 404. KHÔNG đẩy người dùng sang sàn bằng một
    // truy vấn vô nghĩa: vừa che lỗi, vừa tạo traffic affiliate cho thứ không
    // có thật.
    if (!offer) return notFound("Không tìm thấy offer");

    const listing = Array.isArray(offer.listings) ? offer.listings[0] : offer.listings;
    const aff = Array.isArray(offer.affiliate_offers)
      ? offer.affiliate_offers[0]
      : offer.affiliate_offers;

    // /go/shopee/{id của offer Lazada} là link sai — không redirect nhầm sàn.
    if (!listing || listing.marketplace !== marketplace) return notFound("Không tìm thấy offer");
    // Trang sản phẩm không hiện các offer này, nên cũng không đưa người dùng tới.
    if (offer.match_status === "rejected" || listing.status !== "active") {
      return notFound("Offer không còn được theo dõi");
    }

    // 2. Chọn đích TRƯỚC khi ghi click: không ghi click cho lượt không redirect được.
    const affiliateUrl = aff?.eligible ? aff.short_link || aff.affiliate_url : null;
    let targetUrl = affiliateUrl || listing.url;

    // Offer có thật nhưng chưa có đường dẫn mua hàng: 404, không bịa một truy
    // vấn tìm kiếm trên sàn.
    if (!targetUrl) return notFound("Offer chưa có đường dẫn mua hàng");
    if (!isAllowedTarget(targetUrl)) {
      console.error(`/go: đích redirect ngoài allowlist cho offer ${offerId}: ${targetUrl}`);
      return notFound("Offer chưa có đường dẫn mua hàng");
    }

    // 3. Ghi nhận click_events
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
      // Không chặn người dùng mua hàng vì lỗi ghi log, nhưng phải để lại dấu vết:
      // mất click là mất đối soát hoa hồng.
      console.error(`/go: không ghi được click_events cho offer ${offerId}:`, clickRes.error.message);
    }
    const clickEventId = clickRes.data?.id ?? null;

    // 4. Gắn click_ref vào sub_id affiliate (short_link đã đóng gói sẵn tham số).
    if (clickEventId && aff?.eligible && aff.affiliate_url && !aff.short_link) {
      const u = new URL(targetUrl);
      u.searchParams.set("sub_id", clickEventId);
      targetUrl = u.toString();
    }

    const response = NextResponse.redirect(targetUrl, { status: 302, headers: NO_STORE });
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
    return NextResponse.json(
      { error: "Không xử lý được liên kết" },
      { status: 500, headers: NO_STORE },
    );
  }
}
