import { NextResponse, type NextRequest } from "next/server";
import { parseShopeeUrl } from "@/lib/shopee/parse-url";
import { resolveShopeeRedirect } from "@/lib/shopee/resolve-redirect";
import { hashIp, checkLookupLimit, recordLookup } from "@/lib/rate-limit";
import { resolveOrIngestShopee } from "@/lib/ingest";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rawUrl = body?.url;

    if (!rawUrl || typeof rawUrl !== "string") {
      return NextResponse.json(
        {
          status: "error",
          code: "not_a_url",
          message: "Hãy dán một đường dẫn sản phẩm.",
        },
        { status: 400 },
      );
    }

    // 1. Phân tích URL Shopee
    let parsed = parseShopeeUrl(rawUrl);

    if (!parsed.ok && parsed.reason === "needs_redirect") {
      const redirectRes = await resolveShopeeRedirect(rawUrl);
      if (!redirectRes.ok) {
        return NextResponse.json(
          {
            status: "error",
            code: "unrecognized_format",
            message: "Không đọc được đường dẫn này. Hãy thử sao chép lại từ ứng dụng Shopee.",
          },
          { status: 400 },
        );
      }
      parsed = parseShopeeUrl(redirectRes.finalUrl);
    }

    if (!parsed.ok) {
      if (parsed.reason === "not_shopee") {
        return NextResponse.json(
          {
            status: "error",
            code: "not_shopee",
            message: "Hiện tại mới hỗ trợ Shopee.",
          },
          { status: 400 },
        );
      }
      if (parsed.reason === "not_a_url") {
        return NextResponse.json(
          {
            status: "error",
            code: "not_a_url",
            message: "Hãy dán một đường dẫn sản phẩm.",
          },
          { status: 400 },
        );
      }
      return NextResponse.json(
        {
          status: "error",
          code: "unrecognized_format",
          message: "Không đọc được đường dẫn này. Hãy thử sao chép lại từ ứng dụng Shopee.",
        },
        { status: 400 },
      );
    }

    // 2. Lấy IP hash và kiểm tra rate limit
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";
    const ipHash = hashIp(ip);

    const limitVerdict = await checkLookupLimit({
      ipHash,
      userId: null,
      isIngest: true,
    });

    if (!limitVerdict.allowed) {
      const isUpstreamCap = limitVerdict.reason === "global_daily";
      return NextResponse.json(
        {
          status: "error",
          code: isUpstreamCap ? "upstream_unavailable" : "rate_limited",
          message: isUpstreamCap
            ? "Chưa lấy được dữ liệu từ Shopee lúc này."
            : `Bạn đã tra cứu khá nhiều. Thử lại sau ${limitVerdict.retryAfterSeconds}s.`,
          retryAfter: limitVerdict.retryAfterSeconds,
        },
        { status: isUpstreamCap ? 503 : 429 },
      );
    }

    // 3. Tra cứu hoặc Ingest sản phẩm
    const result = await resolveOrIngestShopee({
      shopId: parsed.shopId,
      itemId: parsed.itemId,
    });

    // 4. Ghi nhận nhật ký tra cứu
    if (result.status === "resolved") {
      await recordLookup({ ipHash, userId: null, outcome: "resolved" });
      return NextResponse.json(
        { status: "ok", productUrl: result.productUrl },
        { headers: { "Cache-Control": "no-store" } },
      );
    } else if (result.status === "ingested") {
      await recordLookup({ ipHash, userId: null, outcome: "ingested" });
      return NextResponse.json(
        { status: "ingested", productUrl: result.productUrl },
        { headers: { "Cache-Control": "no-store" } },
      );
    } else {
      await recordLookup({ ipHash, userId: null, outcome: "error" });
      return NextResponse.json(
        {
          status: "error",
          code: result.code,
          message:
            result.code === "upstream_unavailable"
              ? "Chưa lấy được dữ liệu từ Shopee lúc này."
              : "Có lỗi xảy ra. Vui lòng thử lại.",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
  } catch (err) {
    console.error("Lỗi api/lookup:", err);
    return NextResponse.json(
      {
        status: "error",
        code: "internal",
        message: "Có lỗi xảy ra. Vui lòng thử lại.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
