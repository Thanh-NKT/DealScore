import { NextResponse, type NextRequest } from "next/server";
import { acquireJobLock, isAuthorizedCronRequest, releaseJobLock } from "@/lib/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { recomputeSellerProfiles } from "@/lib/sellers/profile-job";
import { recomputeCategorySeasons } from "@/lib/seasons/job";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * pg_cron 'dealscore-insights' (0065, hourly): seller price profiles (P4 H) then category season stats (P4 A).
 * Each pass only redoes stale work (older than 7 days), so a weekly cadence emerges and a large catalog
 * finishes over several runs. Writes only the two insight caches — nothing Deal Score / search / alerts read.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Missing CRON_SECRET" }, { status: 500, headers: NO_STORE });
  if (!isAuthorizedCronRequest(request.headers, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const admin = createAdminClient();
  const owner = await acquireJobLock(admin, "insights");
  if (!owner) return NextResponse.json({ skipped: "locked" }, { headers: NO_STORE });

  const now = new Date();
  const deadline = Date.now() + 50_000;
  try {
    let sellers: unknown;
    let seasons: unknown;
    try {
      sellers = await recomputeSellerProfiles({ now, deadline }, admin);
    } catch (err) {
      reportError(err, { job: "insights", where: "seller_profiles" });
      sellers = { error: "failed" };
    }
    try {
      seasons = await recomputeCategorySeasons({ now, deadline }, admin);
    } catch (err) {
      reportError(err, { job: "insights", where: "category_seasons" });
      seasons = { error: "failed" };
    }
    return NextResponse.json({ sellers, seasons }, { headers: NO_STORE });
  } finally {
    await releaseJobLock(admin, "insights", owner);
  }
}
