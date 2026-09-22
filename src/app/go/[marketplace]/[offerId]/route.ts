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

    if (offerError || !offer) {
      // Nếu không tìm thấy offer trong DB (chẳng hạn ở môi trường demo)
      // Cho phép redirect tạm thời sang Shopee search nếu offer là mock
      return NextResponse.redirect(
        `https://shopee.vn/search?keyword=${encodeURIComponent(offerId)}`,
        { status: 302, headers: { "Cache-Control": "no-store" } },
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

    if (!targetUrl) {
      targetUrl = `https://shopee.vn/search?keyword=${encodeURIComponent(offerId)}`;
    } else if (clickEventId && aff?.affiliate_url && !aff?.short_link) {
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
    console.error(`Lỗi redirect /go/${marketplace}/${offerId}:`, err);
    return NextResponse.redirect("https://shopee.vn", {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
