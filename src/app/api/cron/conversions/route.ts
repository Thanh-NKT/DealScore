import { NextResponse, type NextRequest } from "next/server";
import { acquireJobLock, isAuthorizedCronRequest, releaseJobLock } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { createShopeeAffiliateClient, ShopeeAffiliateError } from "@/lib/affiliate/shopee-client";
import { pullConversions } from "@/lib/affiliate/import";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const client = createShopeeAffiliateClient();
  if (!client) return NextResponse.json({ skipped: "not_configured" }, { headers: NO_STORE });

  const admin = createAdminClient();
  const owner = await acquireJobLock(admin, "conversions");
  if (!owner) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  try {
    const result = await pullConversions({ client, now: new Date(), deadline: Date.now() + 50_000 });
    if (!result.complete) {
      // The newest slices are in; older ones (status updates) wait for the next run. Never silent: the
      // window no longer fits the time limit, which needs attention before it grows further.
      reportError(new Error("Conversion pull stopped at the deadline before the end of the window"), {
        job: "conversions",
        pages: result.pages,
        pulledFrom: result.pulledFrom,
      });
      return NextResponse.json({ ...result, error: "incomplete" }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    reportError(err, { job: "conversions" });
    const retryable = err instanceof ShopeeAffiliateError && (err.retryable || err.auth);
    return NextResponse.json({ error: retryable ? "upstream_unavailable" : "internal" }, {
      status: retryable ? 503 : 500,
      headers: NO_STORE,
    });
  } finally {
    await releaseJobLock(admin, "conversions", owner);
  }
}
