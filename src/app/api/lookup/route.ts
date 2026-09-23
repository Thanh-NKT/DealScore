import { NextResponse, type NextRequest } from "next/server";
import { clientIp, hashIp } from "@/lib/rate-limit";
import { lookupErrorMessage, lookupShopeeUrl, type LookupErrorCode } from "@/lib/lookup";
import { createClient } from "@/lib/supabase/server";

const NO_STORE = { "Cache-Control": "no-store" };

const STATUS_BY_CODE: Record<LookupErrorCode, number> = {
  not_a_url: 400,
  not_shopee: 400,
  unrecognized_format: 400,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal: 500,
};

function errorResponse(code: LookupErrorCode, retryAfter?: number) {
  return NextResponse.json(
    { status: "error", code, message: lookupErrorMessage(code, retryAfter), retryAfter },
    {
      status: STATUS_BY_CODE[code],
      headers: retryAfter ? { ...NO_STORE, "Retry-After": String(retryAfter) } : NO_STORE,
    },
  );
}

export async function POST(request: NextRequest) {
  let rawUrl: unknown;
  try {
    rawUrl = (await request.json())?.url;
  } catch {
    return errorResponse("not_a_url");
  }
  if (!rawUrl || typeof rawUrl !== "string") {
    return errorResponse("not_a_url");
  }

  try {
    // Người đã đăng nhập có hạn mức riêng (60 ingest/giờ) thay vì chung theo IP.
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();

    const result = await lookupShopeeUrl({
      raw: rawUrl,
      ipHash: hashIp(clientIp(request.headers)),
      userId: auth.user?.id ?? null,
    });

    if (result.status === "error") {
      return errorResponse(result.code, result.retryAfter);
    }
    return NextResponse.json(
      { status: result.status, productUrl: result.productUrl },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("Lỗi api/lookup:", err);
    return errorResponse("internal");
  }
}
