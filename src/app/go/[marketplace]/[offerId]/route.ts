import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

interface RouteProps {
  params: Promise<{
    marketplace: string;
    offerId: string;
  }>;
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  const { marketplace, offerId } = await params;
  const { searchParams } = new URL(request.url);

  const rawSrc = searchParams.get("src");
  const validSources = ["web", "extension", "email", "push"] as const;
  const source = validSources.includes(rawSrc as "web")
    ? (rawSrc as "web" | "extension" | "email" | "push")
    : "web";

  const watchId = searchParams.get("watch") || null;

  try {
    const supabase = createAdminClient();

    // 1. Tìm offer + affiliate_offers + listings
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(`
        id,
        listings ( url ),
        affiliate_offers ( short_link, affiliate_url, eligible )
      `)
      .eq("id", offerId)
      .maybeSingle();

    // Offer không tồn tại là 404. KHÔNG đẩy người dùng sang sàn bằng một
    // truy vấn vô nghĩa: vừa che lỗi, vừa tạo traffic affiliate cho thứ không
    // có thật.
    if (offerError || !offer) {
      return NextResponse.json(
        { error: "Không tìm thấy offer" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listing = (Array.isArray(offer.listings) ? offer.listings[0] : offer.listings) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const aff = (Array.isArray(offer.affiliate_offers) ? offer.affiliate_offers[0] : offer.affiliate_offers) as any;

    let clickEventId: string | null = null;

    // 2. Ghi nhận click_events
    try {
      const { data: clickData } = await supabase
        .from("click_events")
        .insert({
          offer_id: offerId,
          source,
          watch_id: watchId,
        })
        .select("id")
        .single();
      clickEventId = clickData?.id || null;
    } catch (e) {
      console.warn("Không thể ghi nhận click_events:", e);
    }

    // 3. Quyết định target URL chuyển hướng
    let targetUrl = aff?.short_link || aff?.affiliate_url || listing?.url;

    // Offer có thật nhưng chưa có đường dẫn mua hàng: 404, không bịa một truy
    // vấn tìm kiếm trên sàn.
    if (!targetUrl) {
      return NextResponse.json(
        { error: "Offer chưa có đường dẫn mua hàng" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (clickEventId && aff?.affiliate_url && !aff?.short_link) {
      // Gắn click_ref vào sub_id affiliate
      const u = new URL(targetUrl);
      u.searchParams.set("sub_id", clickEventId);
      targetUrl = u.toString();
    }

    return NextResponse.redirect(targetUrl, {
      status: 302,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Lỗi hạ tầng phải hiện ra là lỗi, không ngụy trang thành một cú redirect.
    console.error(`Lỗi redirect /go/${marketplace}/${offerId}:`, err);
    return NextResponse.json(
      { error: "Không xử lý được liên kết" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
