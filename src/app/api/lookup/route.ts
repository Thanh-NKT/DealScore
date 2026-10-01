import { NextResponse, type NextRequest } from "next/server";
import { clientIp, hashIp } from "@/lib/rate-limit";
import { lookupErrorMessage, lookupProductUrl, type LookupErrorCode } from "@/lib/lookup";
import { createClient } from "@/lib/supabase/server";
import { trackAfter } from "@/lib/analytics/track";

const INVALID_CODES: ReadonlySet<LookupErrorCode> = new Set(["not_a_url", "not_shopee", "unrecognized_format"]);

const NO_STORE = { "Cache-Control": "no-store" };

const STATUS_BY_CODE: Record<LookupErrorCode, number> = {
  not_a_url: 400,
  not_shopee: 400,
  unrecognized_format: 400,
  rate_limited: 429,
  upstream_unavailable: 503,
  internal: 500,
};

function errorResponse(code: LookupErrorCode, retryAfter?: number, market?: string) {
  return NextResponse.json(
    { status: "error", code, message: lookupErrorMessage(code, retryAfter), retryAfter, market },
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
    // Signed-in users get their own quota (60 ingests/hour) instead of the shared per-IP one.
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();

    const result = await lookupProductUrl({
      raw: rawUrl,
      ipHash: hashIp(clientIp(request.headers)),
      userId: auth.user?.id ?? null,
    });

    trackAfter("lookup_submitted", {
      userId: auth.user?.id ?? null,
      props: {
        outcome:
          result.status !== "error"
            ? result.status
            : INVALID_CODES.has(result.code)
              ? "invalid"
              : result.code === "rate_limited"
                ? "rejected"
                : "error",
      },
    });

    if (result.status === "error") {
      return errorResponse(result.code, result.retryAfter, result.market);
    }
    return NextResponse.json(
      { status: result.status, productUrl: result.productUrl },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("api/lookup error:", err);
    return errorResponse("internal");
  }
}
